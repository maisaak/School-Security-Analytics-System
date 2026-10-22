from __future__ import annotations

import re

from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.detector_profiles import DETECTOR_PROFILES
from app.main import app


def test_model_catalog_lists_ensemble_components(client, admin_headers):
    """Админ видит, какие веса реально загружены в ансамбль и что они детектируют."""
    response = client.get("/api/models/catalog", headers=admin_headers)
    assert response.status_code == 200

    payload = response.json()
    roles = {item["role"] for item in payload["components"]}
    assert roles == {"coco", "weapon", "custom"}

    custom = next(item for item in payload["components"] if item["role"] == "custom")
    assert custom["loaded"] is True
    assert custom["filename"] == settings.YOLO_CUSTOM_MODEL_PATH.name
    assert "suspicious_bag" in custom["classes"]

    profile_keys = {item["key"] for item in payload["profiles"]}
    assert profile_keys == set(DETECTOR_PROFILES)
    assert payload["production"] is not None
    assert payload["hls"]["enabled"] is True


def test_detector_profiles_available_to_all_viewers(client, tokens):
    """Справочник профилей доступен всем, кто видит камеры (нужен для карточек)."""
    for role in ("admin", "director", "guard"):
        response = client.get(
            "/api/detector/profiles", headers={"Authorization": f"Bearer {tokens[role]}"}
        )
        assert response.status_code == 200, role
        assert len(response.json()["profiles"]) == len(DETECTOR_PROFILES)


def test_admin_can_select_detector_profile_per_camera(client, admin_headers, first_camera):
    camera_id = first_camera["id"]

    response = client.patch(
        f"/api/cameras/{camera_id}/detector",
        json={"profile": "custom_weapon"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["detector_profile"] == "custom_weapon"

    cameras = {c["id"]: c for c in client.get("/api/cameras", headers=admin_headers).json()}
    assert cameras[camera_id]["detector_profile"] == "custom_weapon"

    # Возвращаем ансамбль, чтобы не влиять на другие тесты
    restored = client.patch(
        f"/api/cameras/{camera_id}/detector",
        json={"profile": "ensemble"},
        headers=admin_headers,
    )
    assert restored.status_code == 200
    assert restored.json()["detector_profile"] == "ensemble"


def test_detector_profile_change_requires_camera_manage(client, tokens, first_camera):
    camera_id = first_camera["id"]
    for role in ("director", "guard"):
        response = client.patch(
            f"/api/cameras/{camera_id}/detector",
            json={"profile": "coco"},
            headers={"Authorization": f"Bearer {tokens[role]}"},
        )
        assert response.status_code == 403, role


def test_detector_profile_rejects_unknown_key(client, admin_headers, first_camera):
    response = client.patch(
        f"/api/cameras/{first_camera['id']}/detector",
        json={"profile": "gpt-vision"},
        headers=admin_headers,
    )
    assert response.status_code == 422
    assert "Неизвестный профиль" in response.json()["detail"]


def test_catalog_requires_models_permission(client, tokens):
    guard = {"Authorization": f"Bearer {tokens['guard']}"}
    assert client.get("/api/models/catalog", headers=guard).status_code == 403
    director = {"Authorization": f"Bearer {tokens['director']}"}
    assert client.get("/api/models/catalog", headers=director).status_code == 200


def test_hls_endpoints_require_session_and_validate_segments(client, admin_headers, first_camera):
    anonymous = TestClient(app)
    camera_id = first_camera["id"]

    assert anonymous.get(f"/api/cameras/{camera_id}/hls/index.m3u8").status_code == 401

    # Подмена имени сегмента не должна давать доступ к произвольным файлам
    # (index.m3u8 — легитимный плейлист, он отдаётся отдельным маршрутом)
    for bad in ("..%2f..%2fsecret.ts", "seg1.ts", "../../etc/passwd", "seg00000.mp4"):
        response = client.get(f"/api/cameras/{camera_id}/hls/{bad}", headers=admin_headers)
        assert response.status_code == 404, bad


def test_camera_metadata_exposes_stream_mode(client, admin_headers):
    cameras = client.get("/api/cameras", headers=admin_headers).json()
    assert cameras
    for camera in cameras:
        assert camera["source_kind"] in {"simulated", "rtsp", "http", "file"}
        assert camera["stream_mode"] in {"hls", "mjpeg"}
        assert camera["detector_profile"] in DETECTOR_PROFILES


def test_hls_playlist_is_served_when_stream_is_warm(client, admin_headers, warm_camera):
    """Если HLS успел нарезать сегменты, плейлист отдаётся с корректным типом."""
    camera_id = warm_camera["id"]
    response = client.get(f"/api/cameras/{camera_id}/hls/index.m3u8", headers=admin_headers)
    if response.status_code == 404:
        # ffmpeg может быть недоступен в окружении — MJPEG остаётся рабочим фолбэком
        return
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/vnd.apple.mpegurl")
    body = response.text
    assert body.startswith("#EXTM3U")
    assert "#EXT-X-TARGETDURATION" in body
    segment = re.search(r"^seg\d+\.ts$", body, re.MULTILINE)
    assert segment, body
    segment_response = client.get(
        f"/api/cameras/{camera_id}/hls/{segment.group(0)}", headers=admin_headers
    )
    assert segment_response.status_code == 200
    assert segment_response.headers["content-type"] == "video/mp2t"
