from __future__ import annotations

import csv
import io
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.config import PROJECT_ROOT, settings
from app.db.models import Violation
from app.db.session import SessionLocal
from app.main import app
from app.services.event_bus import event_bus
from app.services.totp import totp_code


def _login(username: str, password: str) -> str:
    probe = TestClient(app)
    response = probe.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest.fixture(scope="module")
def admin() -> dict[str, str]:
    token = _login(settings.DEMO_ADMIN_USERNAME, settings.DEMO_ADMIN_PASSWORD)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def guard() -> dict[str, str]:
    token = _login(settings.DEMO_GUARD_USERNAME, settings.DEMO_GUARD_PASSWORD)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def director() -> dict[str, str]:
    token = _login(settings.DEMO_DIRECTOR_USERNAME, settings.DEMO_DIRECTOR_PASSWORD)
    return {"Authorization": f"Bearer {token}"}


def _ensure_violation(camera_id: int = 1, violation_type: str = "weapon") -> Violation:
    """Гарантирует наличие неподтверждённого инцидента с реальным файлом снимка."""
    db = SessionLocal()
    try:
        candidates = (
            db.query(Violation)
            .filter(
                Violation.is_false_alarm.is_(False),
                Violation.is_acknowledged.is_(False),
                Violation.violation_type == violation_type,
            )
            .all()
        )
        for row in candidates:
            if (settings.MEDIA_ROOT / row.image_path.removeprefix("/media/")).is_file():
                return row
        folder = settings.MEDIA_ROOT / "snapshots"
        folder.mkdir(parents=True, exist_ok=True)
        name = f"test_v3_{int(time.time() * 1000)}.jpg"
        image = np.full((540, 960, 3), 40, dtype=np.uint8)
        cv2.rectangle(image, (300, 150), (640, 470), (0, 200, 255), 3)
        cv2.imwrite(str(folder / name), image)
        row = Violation(
            camera_id=camera_id,
            violation_type=violation_type,
            confidence=0.91,
            bbox_json=json.dumps([300, 150, 640, 470]),
            image_path=f"/media/snapshots/{name}",
            video_path=None,
            detected_at=datetime.now(timezone.utc),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    finally:
        db.close()


# ─── SSE и события ──────────────────────────────────────────────────────────

def test_events_recent_requires_auth(client):
    anonymous = TestClient(app)
    assert anonymous.get("/api/events/recent").status_code == 401
    assert anonymous.get("/api/events/stream").status_code == 401


def test_events_recent_collects_published_events(client, admin):
    event_bus.publish("test.marker", {"value": 42})
    response = client.get("/api/events/recent", headers=admin, params={"limit": 40})
    assert response.status_code == 200
    payload = response.json()
    assert payload["items"]
    assert any(item["type"] == "test.marker" for item in payload["items"])
    assert "emergency" in payload


# ─── Журнал: пагинация, сортировка, ложные срабатывания ────────────────────

def test_violations_pagination_and_filters(client, admin):
    _ensure_violation()
    response = client.get(
        "/api/violations/page",
        headers=admin,
        params={"limit": 2, "offset": 0, "sort": "-confidence"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 1
    assert payload["limit"] == 2
    assert payload["has_more"] is (payload["total"] > 2)
    assert "summary" in payload and "false_alarms" in payload["summary"]
    if len(payload["items"]) >= 2:
        assert payload["items"][0]["confidence"] >= payload["items"][1]["confidence"]

    empty = client.get(
        "/api/violations/page",
        headers=admin,
        params={"date_from": "2000-01-01", "date_to": "2000-01-02"},
    )
    assert empty.status_code == 200
    assert empty.json()["total"] == 0


def test_false_alarm_marking_and_ack_latency(client, admin):
    row = _ensure_violation()
    ack = client.patch(f"/api/violations/{row.id}/ack", headers=admin)
    assert ack.status_code == 200
    assert ack.json()["acknowledged_latency_sec"] is not None

    # повторное нажатие снимает подтверждение и SLA-метку
    unack = client.patch(f"/api/violations/{row.id}/ack", headers=admin)
    assert unack.status_code == 200
    assert unack.json()["acknowledged_latency_sec"] is None

    false_alarm = client.patch(
        f"/api/violations/{row.id}/false-alarm",
        headers=admin,
        json={"is_false_alarm": True, "notes": "Проверка стенда"},
    )
    assert false_alarm.status_code == 200
    assert false_alarm.json()["is_false_alarm"] is True

    filtered = client.get(
        "/api/violations", headers=admin, params={"false_alarm": True, "limit": 100}
    )
    assert filtered.status_code == 200
    assert all(item["is_false_alarm"] for item in filtered.json())

    # возвращаем как было, чтобы не влиять на активное обучение ниже
    restore = client.patch(
        f"/api/violations/{row.id}/false-alarm", headers=admin, json={"is_false_alarm": False}
    )
    assert restore.status_code == 200


# ─── Зоны, пороги, расписание, A/B ─────────────────────────────────────────

def test_camera_zones_and_policy(client, admin, guard):
    payload = {
        "zones": [
            {"name": "Крыльцо", "kind": "include", "color": "#10b981", "points": [[0.1, 0.2], [0.9, 0.2], [0.8, 0.95]]},
            {"name": "Парковка", "kind": "exclude", "color": "#ef4444", "points": [[0.0, 0.0], [0.3, 0.0], [0.3, 0.3]]},
        ]
    }
    saved = client.put("/api/cameras/1/zones", headers=admin, json=payload)
    assert saved.status_code == 200, saved.text
    assert len(saved.json()["zones"]) == 2

    listed = client.get("/api/cameras/1/zones", headers=admin)
    assert listed.status_code == 200
    assert [zone["name"] for zone in listed.json()["zones"]] == ["Крыльцо", "Парковка"]

    bad = client.put(
        "/api/cameras/1/zones",
        headers=admin,
        json={"zones": [{"name": "Точка", "points": [[0.1, 0.1], [0.2, 0.2]]}]},
    )
    assert bad.status_code == 422

    # охранник не управляет зонами, но видит их
    denied = client.put("/api/cameras/1/zones", headers=guard, json={"zones": []})
    assert denied.status_code == 403

    policy = client.patch(
        "/api/cameras/1/policy",
        headers=admin,
        json={
            "confidence_threshold": 0.55,
            "schedule": {"enabled": True, "days": [0, 1, 2, 3, 4], "start": "07:30", "end": "19:30"},
            "ab_profile": "weapon",
            "ab_share_pct": 25,
            "turnstile": "Турникет А",
        },
    )
    assert policy.status_code == 200, policy.text
    body = policy.json()
    assert body["confidence_threshold"] == 0.55
    assert body["schedule"]["enabled"] is True
    assert body["ab_profile"] == "weapon"
    assert body["turnstile"] == "Турникет А"

    invalid = client.patch(
        "/api/cameras/1/policy", headers=admin, json={"ab_profile": "неизвестный"}
    )
    assert invalid.status_code == 422

    # отключаем A/B, чтобы не влиять на остальные сценарии
    reset = client.patch(
        "/api/cameras/1/policy",
        headers=admin,
        json={"ab_profile": None, "ab_share_pct": 0, "confidence_threshold": None,
              "schedule": {"enabled": False, "days": [], "start": "07:00", "end": "20:00"}},
    )
    assert reset.status_code == 200


# ─── Аналитика ──────────────────────────────────────────────────────────────

def test_sla_and_heatmap(client, admin, guard):
    _ensure_violation()
    sla = client.get("/api/analytics/sla", headers=admin, params={"days": 30})
    assert sla.status_code == 200
    body = sla.json()
    assert body["target_sec"] >= 1
    assert "by_shift" in body and "day" in body["by_shift"]
    assert "by_guard" in body

    # охране доступен SLA-отчёт смены, но не полная аналитика
    assert client.get("/api/analytics/sla", headers=guard).status_code == 200
    assert client.get("/api/analytics/heatmap", headers=guard).status_code == 403

    heatmap = client.get("/api/analytics/heatmap", headers=admin, params={"days": 30})
    assert heatmap.status_code == 200
    matrix = heatmap.json()["matrix"]
    assert len(matrix) == 7 and all(len(row) == 24 for row in matrix)
    assert "top_false_alarm_cameras" in heatmap.json()

    quality = client.get("/api/analytics/quality", headers=admin).json()
    assert 0 <= quality["false_alarm_rate"] <= 100

    ab = client.get("/api/analytics/ab", headers=admin)
    assert ab.status_code == 200
    assert "variants" in ab.json()


# ─── Отчёты и защищённые выгрузки ──────────────────────────────────────────

def test_pdf_and_excel_reports(client, admin, guard):
    pdf = client.get("/api/analytics/reports/incidents.pdf", headers=admin)
    assert pdf.status_code == 200, pdf.text
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")
    assert len(pdf.content) > 5000

    xlsx = client.get("/api/analytics/reports/incidents.xlsx", headers=admin)
    assert xlsx.status_code == 200
    assert xlsx.content[:2] == b"PK"
    assert len(xlsx.content) > 3000

    preview = client.get("/api/analytics/reports/preview", headers=admin)
    assert preview.status_code == 200
    assert preview.json()["summary"]["total"] >= 1
    assert "Перспектива" in preview.json()["watermark"]

    assert client.get("/api/analytics/reports/incidents.pdf", headers=guard).status_code == 403

    audit = client.get("/api/audit", headers=admin, params={"action": "report.download"})
    assert audit.status_code == 200
    assert audit.json()["total"] >= 1


def test_snapshot_watermark_blur_and_view_log(client, admin):
    row = _ensure_violation()
    plain = client.get(f"/api/violations/{row.id}/snapshot", headers=admin, params={"watermark": False})
    assert plain.status_code == 200
    assert plain.headers["content-type"] == "image/jpeg"

    protected = client.get(
        f"/api/violations/{row.id}/snapshot",
        headers=admin,
        params={"watermark": True, "blur_faces": True, "download": True},
    )
    assert protected.status_code == 200
    assert "attachment" in protected.headers.get("content-disposition", "")
    assert len(protected.content) > 1000

    audit = client.get("/api/audit", headers=admin, params={"action": "violation.snapshot_view"})
    assert audit.status_code == 200
    assert audit.json()["total"] >= 1


def test_active_learning_adds_incident_to_dataset(client, admin, guard):
    row = _ensure_violation()
    client.patch(f"/api/violations/{row.id}/false-alarm", headers=admin, json={"is_false_alarm": False})
    response = client.post(f"/api/violations/{row.id}/to-dataset", headers=admin)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "added"
    assert body["violation_type"] == "weapon"
    assert (PROJECT_ROOT / "ml" / "datasets" / "custom" / "images" / "train" / body["filename"]).is_file()

    # дообучение датасета — только администратор
    assert client.post(f"/api/violations/{row.id}/to-dataset", headers=guard).status_code == 403


# ─── Эксплуатация ───────────────────────────────────────────────────────────

def test_retention_policy_and_cleanup(client, admin):
    updated = client.put(
        "/api/ops/retention", headers=admin, json={"days": 14, "max_gb": 1.5, "auto_clean": False}
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["days"] == 14
    assert updated.json()["usage_mb"] >= 0

    cleanup = client.post("/api/ops/retention/cleanup", headers=admin)
    assert cleanup.status_code == 200
    assert "deleted_expired" in cleanup.json()

    forbidden = TestClient(app).get("/api/ops/retention")
    assert forbidden.status_code == 401


def test_backup_creation_and_restore_guardrails(client, admin):
    created = client.post("/api/ops/backups", headers=admin)
    assert created.status_code == 200, created.text
    manifest = created.json()
    assert manifest["filename"].startswith("school_security_")
    assert manifest["size_mb"] > 0

    listing = client.get("/api/ops/backups", headers=admin)
    assert listing.status_code == 200
    assert any(item["filename"] == manifest["filename"] for item in listing.json()["items"])

    refused = client.post(
        "/api/ops/backups/restore",
        headers=admin,
        json={"filename": manifest["filename"], "confirm": "нет"},
    )
    assert refused.status_code == 400

    missing = client.post(
        "/api/ops/backups/restore",
        headers=admin,
        json={"filename": "does_not_exist.sqlite3", "confirm": "ВОССТАНОВИТЬ"},
    )
    assert missing.status_code == 404


def test_notifications_settings_and_validation(client, admin):
    current = client.get("/api/ops/notifications", headers=admin)
    assert current.status_code == 200
    assert "bot_token_set" in current.json()
    assert current.json()["bot_token"] != settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_BOT_TOKEN

    saved = client.put(
        "/api/ops/notifications",
        headers=admin,
        json={"enabled": True, "guard_chat_id": "-100123456", "notify_bag": True, "notify_dog": True},
    )
    assert saved.status_code == 200
    assert saved.json()["guard_chat_id"] == "-100123456"
    assert saved.json()["notify_dog"] is True

    # без токена тест отправки возвращает понятную ошибку, а не 500
    tested = client.post("/api/ops/notifications/test", headers=admin)
    assert tested.status_code == 400

    client.put(
        "/api/ops/notifications",
        headers=admin,
        json={"enabled": False, "guard_chat_id": "", "notify_dog": False},
    )


def test_emergency_mode_and_events(client, admin, guard):
    started = client.post(
        "/api/ops/emergency", headers=guard, json={"active": True, "reason": "Учебная эвакуация"}
    )
    assert started.status_code == 200, started.text
    assert started.json()["active"] is True
    assert started.json()["started_by"] == settings.DEMO_GUARD_USERNAME

    state = client.get("/api/ops/emergency", headers=admin).json()
    assert state["active"] is True

    events = client.get("/api/events/recent", headers=admin).json()["items"]
    assert any(item["type"] == "emergency" for item in events)

    cleared = client.post("/api/ops/emergency", headers=admin, json={"active": False, "reason": "Отбой"})
    assert cleared.status_code == 200
    assert cleared.json()["active"] is False


def test_ops_overview_and_metrics(client, admin):
    overview = client.get("/api/ops/overview", headers=admin)
    assert overview.status_code == 200
    body = overview.json()
    for section in ("database", "media", "retention", "backups", "events", "workers"):
        assert section in body
    assert body["database"]["violations"] >= 1

    metrics = client.get("/metrics")
    assert metrics.status_code == 200
    assert "school_http_requests_total" in metrics.text
    assert client.get("/api/ops/metrics", headers=admin).status_code == 200


def test_model_exports_listing_and_missing_version(client, admin):
    listing = client.get("/api/models/exports", headers=admin)
    assert listing.status_code == 200
    assert "onnx" in listing.json()["formats"]
    assert client.post("/api/models/versions/999999/export", headers=admin).status_code == 404


# ─── 2FA и пароли ──────────────────────────────────────────────────────────

def test_two_factor_full_flow(client, admin):
    status = client.get("/api/auth/2fa/status", headers=admin).json()
    assert status["enabled"] is False

    setup = client.post("/api/auth/2fa/setup", headers=admin)
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    codes = setup.json()["recovery_codes"]
    assert len(codes) == 8
    assert setup.json()["otpauth_uri"].startswith("otpauth://totp/")

    wrong = client.post("/api/auth/2fa/enable", headers=admin, json={"code": "000000"})
    assert wrong.status_code == 400

    enabled = client.post("/api/auth/2fa/enable", headers=admin, json={"code": totp_code(secret)})
    assert enabled.status_code == 200, enabled.text

    try:
        fresh = TestClient(app)
        challenge = fresh.post(
            "/api/auth/login",
            json={"username": settings.DEMO_ADMIN_USERNAME, "password": settings.DEMO_ADMIN_PASSWORD},
        )
        assert challenge.status_code == 401
        assert challenge.headers.get("x-2fa-required") == "1"

        # резервный код одноразовый
        recovery_login = fresh.post(
            "/api/auth/login",
            json={
                "username": settings.DEMO_ADMIN_USERNAME,
                "password": settings.DEMO_ADMIN_PASSWORD,
                "totp_code": codes[0],
            },
        )
        assert recovery_login.status_code == 200, recovery_login.text
        reuse = fresh.post(
            "/api/auth/login",
            json={
                "username": settings.DEMO_ADMIN_USERNAME,
                "password": settings.DEMO_ADMIN_PASSWORD,
                "totp_code": codes[0],
            },
        )
        assert reuse.status_code == 401

        with_code = fresh.post(
            "/api/auth/login",
            json={
                "username": settings.DEMO_ADMIN_USERNAME,
                "password": settings.DEMO_ADMIN_PASSWORD,
                "totp_code": totp_code(secret),
            },
        )
        assert with_code.status_code == 200
    finally:
        disabled = client.post(
            "/api/auth/2fa/disable", headers=admin, json={"current_password": settings.DEMO_ADMIN_PASSWORD}
        )
        assert disabled.status_code == 200


def test_password_policy_blocks_weak_passwords(client, admin):
    weak = client.post(
        "/api/users",
        headers=admin,
        json={"username": "weak_user", "password": "password", "full_name": "Слабый", "role": "guard"},
    )
    assert weak.status_code == 400
    assert "Пароль" in weak.json()["detail"]

    strong = client.post(
        "/api/users",
        headers=admin,
        json={"username": "strong_user", "password": "SchoolPass2026", "full_name": "Сильный", "role": "guard"},
    )
    assert strong.status_code == 201, strong.text
    client.delete(f"/api/users/{strong.json()['id']}", headers=admin)


def test_account_lockout_after_repeated_failures(client, admin):
    created = client.post(
        "/api/users",
        headers=admin,
        json={"username": "lock_test", "password": "LockTest2026", "full_name": "Блокировка", "role": "guard"},
    )
    assert created.status_code == 201
    user_id = created.json()["id"]

    probe = TestClient(app)
    for _ in range(settings.LOGIN_LOCKOUT_ATTEMPTS):
        probe.post("/api/auth/login", json={"username": "lock_test", "password": "wrong-password"})

    locked = probe.post("/api/auth/login", json={"username": "lock_test", "password": "LockTest2026"})
    assert locked.status_code == 429

    unlocked = client.post(f"/api/security/users/{user_id}/unlock", headers=admin)
    assert unlocked.status_code == 200
    assert probe.post("/api/auth/login", json={"username": "lock_test", "password": "LockTest2026"}).status_code == 200
    client.delete(f"/api/users/{user_id}", headers=admin)


# ─── Доступ по камерам ──────────────────────────────────────────────────────

def test_camera_scope_limits_guard_visibility(client, admin, guard):
    user_id = 3  # демо-охранник
    limited = client.put(
        f"/api/security/users/{user_id}/camera-scope",
        headers=admin,
        json={"camera_ids": [1]},
    )
    assert limited.status_code == 200
    assert limited.json()["camera_ids"] == [1]

    try:
        cams = client.get("/api/cameras", headers=guard)
        assert cams.status_code == 200
        assert [cam["id"] for cam in cams.json()] == [1]

        assert client.get("/api/cameras/2/snapshot", headers=guard).status_code == 403
        assert client.get("/api/cameras/2/stream", headers=guard).status_code == 403
        violations = client.get("/api/violations", headers=guard, params={"limit": 100}).json()
        assert all(item["camera_id"] == 1 for item in violations)
    finally:
        restored = client.put(
            f"/api/security/users/{user_id}/camera-scope",
            headers=admin,
            json={"camera_ids": []},
        )
        assert restored.status_code == 200
        assert restored.json()["camera_ids"] == []

    security = client.get("/api/security/overview", headers=admin)
    assert security.status_code == 200
    assert security.json()["password_policy"]["min_length"] == settings.PASSWORD_MIN_LENGTH


# ─── СКУД и посетители ──────────────────────────────────────────────────────

def test_access_events_and_summary(client, admin, guard):
    summary = client.get("/api/access/summary", headers=admin)
    assert summary.status_code == 200
    assert summary.json()["events"] >= 1
    assert len(summary.json()["hourly"]) == 24

    created = client.post(
        "/api/access/events",
        headers=admin,
        json={
            "person_name": "Тестов Ученик",
            "person_kind": "student",
            "class_name": "7А",
            "turnstile": "Главный вход",
            "direction": "in",
        },
    )
    assert created.status_code == 201
    assert created.json()["direction_label"] == "вход"

    listed = client.get("/api/access/events", headers=guard, params={"search": "Тестов"})
    assert listed.status_code == 200
    assert listed.json()["total"] >= 1

    csv_content = (
        "occurred_at;person_name;person_kind;class_name;turnstile;direction\n"
        f"{datetime.now(timezone.utc).isoformat()};Импорт Ученик;student;8Б;Калитка №2;in\n"
    ).encode("utf-8")
    imported = client.post(
        "/api/access/import",
        headers=admin,
        files={"file": ("turnstile.csv", csv_content, "text/csv")},
    )
    assert imported.status_code == 200, imported.text
    assert imported.json()["created"] == 1


def test_visitor_pass_lifecycle(client, admin, guard):
    created = client.post(
        "/api/visitors",
        headers=guard,
        json={
            "full_name": "Посетителев Иван",
            "organization": "Городская библиотека",
            "purpose": "Встреча с библиотекарем",
            "host": "Ковалёв А.П.",
            "valid_hours": 3,
        },
    )
    assert created.status_code == 201, created.text
    pass_id = created.json()["id"]
    assert created.json()["badge_no"].startswith("V-")
    assert created.json()["status"] == "expected"

    checked_in = client.post(f"/api/visitors/{pass_id}/check-in", headers=guard)
    assert checked_in.status_code == 200
    assert checked_in.json()["status"] == "inside"

    summary = client.get("/api/visitors/summary", headers=admin).json()
    assert summary["inside"] >= 1

    checked_out = client.post(f"/api/visitors/{pass_id}/check-out", headers=guard)
    assert checked_out.status_code == 200
    assert checked_out.json()["status"] == "left"
    assert checked_out.json()["checked_out_at"]

    cancelled = client.post(f"/api/visitors/{pass_id}/cancel", headers=guard)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    assert client.delete(f"/api/visitors/{pass_id}", headers=guard).status_code == 204


def test_access_module_requires_permission(client):
    anonymous = TestClient(app)
    assert anonymous.get("/api/access/summary").status_code == 401
    assert anonymous.get("/api/visitors").status_code == 401
