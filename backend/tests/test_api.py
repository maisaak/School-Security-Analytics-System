from __future__ import annotations

import io
import time

import cv2
from fastapi.testclient import TestClient

from app.core.config import PROJECT_ROOT, settings
from app.main import app


def _wait_for_violation(client, headers, camera_id: int, timeout: float = 120.0) -> dict | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        rows = client.get(
            "/api/violations",
            headers=headers,
            params={"camera_id": camera_id, "limit": 10},
        ).json()
        if rows:
            return rows[0]
        time.sleep(1.0)
    return None


def test_healthcheck_is_public(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["auth"] == "jwt-cookie"


def test_seeded_cameras_are_masked(client, admin_headers):
    cameras = client.get("/api/cameras", headers=admin_headers).json()
    assert len(cameras) >= 3
    for camera in cameras:
        assert camera["rtsp_url"].startswith(("sim://", "rtsp://", "http://", "https://"))
        if camera["has_credentials"]:
            assert "***" in camera["rtsp_url"], "Креды RTSP должны быть замаскированы"


def test_full_detection_pipeline_with_auth(client, admin_headers):
    # 1. Добавление легитимной камеры
    add_res = client.post(
        "/api/cameras",
        headers=admin_headers,
        json={
            "name": "Камера №4 — Спортивный зал",
            "location": "Блок Б, 1 этаж",
            "rtsp_url": "sim://hallway",
        },
    )
    assert add_res.status_code == 201, add_res.text
    cam_id = add_res.json()["id"]

    # 2. Симуляция инцидента и реальная детекция YOLOv8
    sim_res = client.post(
        f"/api/cameras/{cam_id}/simulate",
        headers=admin_headers,
        json={"scenario": "dog"},
    )
    assert sim_res.status_code == 200

    violation = _wait_for_violation(client, admin_headers, cam_id)
    assert violation is not None, "YOLOv8 не зафиксировал нарушение за отведённое время"
    assert violation["violation_type"] in {"dog", "suspicious_bag", "weapon"}
    assert violation["image_path"].startswith("/media/")

    # 3. Защищённая отдача H.264 MP4 и фотофиксации
    assert client.get(violation["video_url"]).status_code == 401
    video = client.get(violation["video_url"], headers=admin_headers)
    assert video.status_code == 200
    assert video.headers["content-type"].startswith("video/mp4")
    assert len(video.content) > 1000
    assert b"ftyp" in video.content[:64]

    snapshot = client.get(violation["image_path"], headers=admin_headers)
    assert snapshot.status_code == 200
    assert snapshot.headers["content-type"].startswith("image/")
    assert snapshot.content[:2] == b"\xff\xd8"

    # 4. Подтверждение охранником (у охранника есть право violations:ack)
    guard_probe = TestClient(app)
    assert guard_probe.post(
        "/api/auth/demo-login", json={"username": settings.DEMO_GUARD_USERNAME}
    ).status_code == 200
    ack = guard_probe.patch(f"/api/violations/{violation['id']}/ack")
    assert ack.status_code == 200
    assert ack.json()["is_acknowledged"] is True
    assert ack.json()["acknowledged_by"] == settings.DEMO_GUARD_USERNAME

    # 5. Удаление улики администратором с очисткой файлов на диске
    snap_disk = settings.MEDIA_ROOT / violation["image_path"].removeprefix("/media/")
    assert snap_disk.is_file()
    assert client.delete(f"/api/violations/{violation['id']}", headers=admin_headers).status_code == 204
    assert not snap_disk.exists()

    # 6. Удаление камеры
    assert client.delete(f"/api/cameras/{cam_id}", headers=admin_headers).status_code == 204


def test_upload_limit_blocks_oversized_files(client, admin_headers):
    previous = settings.MAX_UPLOAD_IMAGE_MB
    settings.MAX_UPLOAD_IMAGE_MB = 1
    try:
        oversized = b"x" * (2 * 1024 * 1024)
        response = client.post(
            "/api/analyze/upload",
            headers=admin_headers,
            files={"file": ("huge.jpg", io.BytesIO(oversized), "image/jpeg")},
        )
        assert response.status_code == 413
    finally:
        settings.MAX_UPLOAD_IMAGE_MB = previous


def test_media_lab_detects_dog_on_upload(client, guard_headers):
    sample = cv2.imread(str(PROJECT_ROOT / "ml" / "assets" / "sprites" / "dog_white.png"))
    assert sample is not None
    ok, encoded = cv2.imencode(".jpg", sample)
    assert ok

    response = client.post(
        "/api/analyze/upload",
        headers=guard_headers,
        files={"file": ("test_dog.jpg", io.BytesIO(encoded.tobytes()), "image/jpeg")},
        data={"save_violation": "false"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["media_type"] == "image"
    assert any(v["type"] == "dog" for v in payload["violations"])

    audit = client.get("/api/audit", headers=guard_headers)  # у охранника нет прав на аудит
    assert audit.status_code == 403


def test_stats_include_tracking_and_model_registry(client, admin_headers):
    stats = client.get("/api/stats", headers=admin_headers).json()
    assert stats["tracking"]["enabled"] is True
    assert stats["tracking"]["dwell_threshold_sec"] == settings.UNATTENDED_DWELL_SEC
    assert stats["model"]["active_weights"]
    assert stats["model"]["production_version"] is not None
    assert 0.0 <= stats["average_confidence"] <= 1.0


def test_camera_toggle_and_simulation_guards(client, admin_headers, first_camera):
    toggled = client.post(f"/api/cameras/{first_camera['id']}/toggle", headers=admin_headers)
    assert toggled.status_code == 200
    paused = toggled.json()["is_active"] is False
    if paused:
        resumed = client.post(f"/api/cameras/{first_camera['id']}/toggle", headers=admin_headers)
        assert resumed.status_code == 200

    assert client.post(
        "/api/cameras/999999/simulate", headers=admin_headers, json={"scenario": "dog"}
    ).status_code == 404
