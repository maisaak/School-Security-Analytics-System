from __future__ import annotations

import csv
import io
from pathlib import Path

import pytest

from app.core.config import settings


@pytest.fixture(scope="module")
def weight_bytes() -> bytes:
    path = Path(settings.YOLO_CUSTOM_MODEL_PATH)
    if not path.is_file():
        pytest.skip(f"Нет весов для проверки загрузки: {path}")
    return path.read_bytes()


def _upload(client, headers, filename="my_model.pt", content=b"", **form):
    data = {"architecture": "auto", "activate": "false", **{k: str(v) for k, v in form.items()}}
    return client.post(
        "/api/models/upload",
        headers=headers,
        files={"file": (filename, content, "application/octet-stream")},
        data=data,
    )


# ─── Персональные настройки интерфейса ──────────────────────────────────────


def test_preferences_defaults_and_roundtrip(client, admin_headers):
    response = client.get("/api/settings/preferences", headers=admin_headers)
    assert response.status_code == 200
    payload = response.json()
    assert payload["theme"] in {"dark", "light", "contrast"}
    assert payload["kpis"], "набор KPI не должен быть пустым"

    updated = client.patch(
        "/api/settings/preferences",
        headers=admin_headers,
        json={
            "theme": "light",
            "accent": "sky",
            "kpis": ["cameras", "critical", "confidence"],
            "compact_tables": True,
            "show_timeline": False,
            "mobile_bottom_nav": False,
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["theme"] == "light"
    assert updated.json()["accent"] == "sky"
    assert updated.json()["kpis"] == ["cameras", "critical", "confidence"]
    assert updated.json()["updated_at"]

    stored = client.get("/api/settings/preferences", headers=admin_headers)
    assert stored.status_code == 200
    assert stored.json()["kpis"] == ["cameras", "critical", "confidence"]
    assert stored.json()["compact_tables"] is True
    assert stored.json()["updated_at"], "время сохранения должно возвращаться в GET"

    audit = client.get(
        "/api/audit", headers=admin_headers, params={"action": "settings.preferences.update"}
    )
    assert audit.status_code == 200
    assert audit.json()["total"] >= 1

    # Возвращаем дефолты, чтобы не влиять на остальные тесты сессии
    restored = client.patch(
        "/api/settings/preferences",
        headers=admin_headers,
        json={
            "theme": "dark",
            "accent": "emerald",
            "kpis": ["cameras", "violations", "dwell", "latency"],
            "compact_tables": False,
            "show_timeline": True,
            "mobile_bottom_nav": True,
        },
    )
    assert restored.status_code == 200
    assert restored.json()["theme"] == "dark"


def test_preferences_reject_invalid_values(client, admin_headers):
    bad_theme = client.patch(
        "/api/settings/preferences", headers=admin_headers, json={"theme": "neon"}
    )
    assert bad_theme.status_code == 422

    unknown_kpi = client.patch(
        "/api/settings/preferences", headers=admin_headers, json={"kpis": ["cameras", "hacker"]}
    )
    assert unknown_kpi.status_code == 422

    empty_kpis = client.patch(
        "/api/settings/preferences", headers=admin_headers, json={"kpis": []}
    )
    assert empty_kpis.status_code == 422


def test_guard_keeps_personal_preferences(client, guard_headers):
    """Охрана тоже может настроить контрастную тему — настройки персональные."""
    current = client.get("/api/settings/preferences", headers=guard_headers)
    assert current.status_code == 200

    payload = current.json()
    payload.update({"theme": "contrast", "compact_tables": True})
    payload.pop("updated_at", None)
    saved = client.patch("/api/settings/preferences", headers=guard_headers, json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["theme"] == "contrast"
    assert saved.json()["kpis"] == current.json()["kpis"]


# ─── Загрузка собственных весов ─────────────────────────────────────────────


def test_catalog_lists_supported_architectures(client, admin_headers):
    payload = client.get("/api/models/catalog", headers=admin_headers).json()
    keys = {item["key"] for item in payload["supported_architectures"]}
    assert {"auto", "yolov8", "yolo11", "custom"}.issubset(keys)
    labels = {item["key"]: item["label"] for item in payload["supported_architectures"]}
    assert labels["yolo11"] == "YOLO11"
    assert labels["auto"] == "Определить автоматически"


def test_upload_custom_weights_registers_candidate(client, admin_headers, weight_bytes):
    response = _upload(
        client,
        admin_headers,
        label="Свои веса YOLO11",
        architecture="auto",
        content=weight_bytes,
        activate="false",
    )
    assert response.status_code == 200, response.text
    result = response.json()

    assert result["version"]["status"] == "candidate"
    assert result["version"]["source"] == "upload"
    assert result["version"]["architecture"] == "yolov8"
    assert result["inspection"]["num_classes"] >= 2
    assert "suspicious_bag" in result["inspection"]["classes"]
    assert result["activated"] is False

    # Временный файл загрузки не должен оставаться в каталоге версий
    leftovers = list(Path(settings.MODEL_VERSIONS_ROOT).glob("upload_*.pt"))
    assert leftovers == [], f"утечка временных файлов: {leftovers}"

    version_id = result["version"]["id"]
    deleted = client.delete(f"/api/models/versions/{version_id}", headers=admin_headers)
    assert deleted.status_code == 204
    assert client.delete(f"/api/models/versions/{version_id}", headers=admin_headers).status_code == 404


def test_upload_with_low_map_is_blocked_by_gate(client, admin_headers, weight_bytes):
    """Validation Gate не пускает в production веса с падением mAP@50."""
    response = _upload(
        client,
        admin_headers,
        label="Слабая модель",
        architecture="auto",
        map50=10,
        activate="true",
        content=weight_bytes,
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["gate_passed"] is False
    assert result["activated"] is False
    assert result["version"]["status"] == "rejected"
    assert "Gate" in result["message"]

    client.delete(f"/api/models/versions/{result['version']['id']}", headers=admin_headers)


def test_upload_rejects_foreign_files_and_mismatched_architecture(
    client, admin_headers, weight_bytes
):
    not_pt = _upload(client, admin_headers, filename="weights.onnx", content=b"0" * 2048)
    assert not_pt.status_code == 415

    too_small = _upload(client, admin_headers, filename="empty.pt", content=b"0" * 64)
    assert too_small.status_code == 400

    mismatch = _upload(
        client,
        admin_headers,
        architecture="yolo11",
        content=weight_bytes,
    )
    assert mismatch.status_code == 422
    assert "YOLO11" in mismatch.json()["detail"]

    bad_map = _upload(client, admin_headers, map50=150, content=weight_bytes)
    assert bad_map.status_code == 422


def test_upload_requires_admin(client, guard_headers):
    response = _upload(client, guard_headers, filename="x.pt", content=b"0" * 2048)
    assert response.status_code == 403


def test_production_version_cannot_be_deleted(client, admin_headers):
    catalog = client.get("/api/models/catalog", headers=admin_headers).json()
    production = catalog["production"]
    if production is None:
        pytest.skip("В реестре нет боевой версии")
    response = client.delete(f"/api/models/versions/{production['id']}", headers=admin_headers)
    assert response.status_code == 409


# ─── Выгрузка журнала нарушений ─────────────────────────────────────────────


def _parse_csv(content: bytes) -> list[list[str]]:
    assert content.startswith(b"\xef\xbb\xbf"), "CSV должен начинаться с UTF-8 BOM (Excel)"
    text = content.decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text), delimiter=";"))


def test_violations_export_is_excel_friendly(client, admin_headers):
    response = client.get(
        "/api/violations/export", headers=admin_headers, params={"limit": 50}
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers.get("content-disposition", "")
    assert "school_security_violations_" in response.headers.get("content-disposition", "")

    rows = _parse_csv(response.content)
    header = rows[0]
    assert header[0] == "id"
    assert header[4] == "violation_type"
    assert "camera" in header
    for row in rows[1:]:
        assert len(row) == len(header)
        assert row[8] in {"да", "нет"}


def test_violations_export_respects_filters(client, admin_headers):
    # Фильтр по несуществующей камере: остаётся только строка заголовка,
    # значит параметры таблицы действительно доезжают до выгрузки.
    empty = client.get(
        "/api/violations/export",
        headers=admin_headers,
        params={"camera_id": 999_999, "limit": 100},
    )
    assert empty.status_code == 200
    rows = _parse_csv(empty.content)
    assert len(rows) == 1

    violations = client.get(
        "/api/violations", headers=admin_headers, params={"violation_type": "weapon", "limit": 5}
    ).json()
    if violations:
        filtered = client.get(
            "/api/violations/export",
            headers=admin_headers,
            params={"violation_type": "weapon", "limit": 100},
        )
        assert filtered.status_code == 200
        assert {row[4] for row in _parse_csv(filtered.content)[1:]} == {"weapon"}

    audit = client.get(
        "/api/audit", headers=admin_headers, params={"action": "violations.export"}
    )
    assert audit.status_code == 200
    assert audit.json()["total"] >= 1


def test_violations_export_requires_permission():
    """Чистый клиент без cookie и токена не должен получать выгрузку."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as fresh_client:
        response = fresh_client.get("/api/violations/export")
    assert response.status_code == 401
