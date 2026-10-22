from __future__ import annotations

import json
from pathlib import Path

from app.core.config import settings
from app.core.security import (
    hash_password,
    mask_stream_url,
    redact_secrets,
    verify_password,
)
from app.db.models import Camera
from app.db.session import SessionLocal


def test_mask_stream_url_hides_credentials():
    raw = "rtsp://admin:SuperSecret123@192.168.1.50:554/h264Preview_01_main"
    masked = mask_stream_url(raw)
    assert "SuperSecret123" not in masked
    assert "admin" not in masked
    assert masked == "rtsp://a***:***@192.168.1.50:554/h264Preview_01_main"
    assert "192.168.1.50" in masked

    assert mask_stream_url("sim://entrance") == "sim://entrance"
    assert mask_stream_url("rtsp://10.0.0.5:554/live") == "rtsp://10.0.0.5:554/live"
    assert mask_stream_url("") == ""
    assert mask_stream_url(None) == ""


def test_redact_secrets_recursively():
    payload = {
        "rtsp_url": "rtsp://user:topsecret@10.1.1.1/stream",
        "password": "topsecret",
        "nested": [{"api_key": "abc123", "note": "rtsp://bob:hunter2@cam/live"}],
        "safe": "просто текст",
    }
    cleaned = redact_secrets(payload)
    blob = json.dumps(cleaned, ensure_ascii=False)
    assert "topsecret" not in blob
    assert "hunter2" not in blob
    assert "abc123" not in blob
    assert cleaned["safe"] == "просто текст"


def test_password_hashing_roundtrip():
    stored = hash_password("CorrectHorse123")
    assert stored.startswith("pbkdf2_sha256$")
    assert verify_password("CorrectHorse123", stored)
    assert not verify_password("wrong", stored)
    assert not verify_password("CorrectHorse123", "broken-hash")


def test_camera_api_never_leaks_rtsp_credentials(client, admin_headers):
    secret = "P@ssw0rd-OnlyOnServer"
    created = client.post(
        "/api/cameras",
        headers=admin_headers,
        json={
            "name": "Камера RTSP с паролем",
            "location": "Серверная",
            "rtsp_url": f"rtsp://operator:{secret}@10.10.0.7:554/live",
        },
    )
    assert created.status_code == 201, created.text
    camera = created.json()
    assert secret not in json.dumps(camera)
    assert camera["has_credentials"] is True
    assert camera["rtsp_url"].startswith("rtsp://")
    assert "***" in camera["rtsp_url"]

    listing = client.get("/api/cameras", headers=admin_headers)
    assert secret not in listing.text

    # На сервере креды сохранены, иначе камера не подключилась бы
    db = SessionLocal()
    try:
        stored = db.query(Camera).filter(Camera.id == camera["id"]).first()
        assert stored is not None and secret in stored.rtsp_url
    finally:
        db.close()

    # Аудит создания камеры также не содержит пароль
    audit = client.get("/api/audit", headers=admin_headers, params={"action": "camera.create"})
    assert secret not in audit.text
    assert "camera.create" in audit.text

    assert client.delete(f"/api/cameras/{camera['id']}", headers=admin_headers).status_code == 204


def test_media_files_require_session(client, admin_headers):
    sample = settings.MEDIA_ROOT / "snapshots" / "test_guard_evidence.jpg"
    sample.parent.mkdir(parents=True, exist_ok=True)
    sample.write_bytes(b"\xff\xd8\xff\xdb" + b"0" * 128)

    try:
        assert client.get("/media/snapshots/test_guard_evidence.jpg").status_code == 401
        ok = client.get("/media/snapshots/test_guard_evidence.jpg", headers=admin_headers)
        assert ok.status_code == 200
        assert ok.content.startswith(b"\xff\xd8")

        traversal = client.get("/media/%2e%2e/school_security.db", headers=admin_headers)
        assert traversal.status_code in {400, 404}

        disallowed = client.get("/media/snapshots/test_guard_evidence.txt", headers=admin_headers)
        assert disallowed.status_code in {404, 415}
    finally:
        sample.unlink(missing_ok=True)


def test_ssrf_and_lfi_guards_still_active(client, admin_headers):
    for bad_url in (
        "/etc/passwd",
        "http://169.254.169.254/latest/meta-data",
        "http://127.0.0.1:8000/health",
        "file:///etc/shadow",
        "gopher://127.0.0.1:6379/_INFO",
    ):
        response = client.post(
            "/api/cameras",
            headers=admin_headers,
            json={"name": "Evil", "location": "Test", "rtsp_url": bad_url},
        )
        assert response.status_code == 400, f"{bad_url} должен быть заблокирован"


def test_dataset_yaml_path_traversal_blocked(client, admin_headers):
    response = client.post(
        "/api/models/retrain",
        headers=admin_headers,
        json={"epochs": 1, "dataset_yaml": "../../etc/passwd"},
    )
    assert response.status_code == 400
