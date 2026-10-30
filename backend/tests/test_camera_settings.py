import pytest

from app.db.models import Camera
from app.db.session import SessionLocal
from app.services.stream_manager import CameraWorker, stream_manager


def payload(**changes):
    return {"name": "Камера входа", "location": "Первый этаж", "target_fps": 8, "jpeg_quality": 70, "detect_every": 2, **changes}


def test_settings_persist_and_restart_worker(client, monkeypatch):
    camera = client.post("/api/cameras", json={"name": "Entrance", "rtsp_url": "sim://entrance"}).json()
    calls = []
    monkeypatch.setattr(stream_manager, "start_camera", lambda *args, **kwargs: calls.append((args, kwargs)))
    client.post(f"/api/cameras/{camera['id']}/toggle")
    response = client.put(f"/api/cameras/{camera['id']}/settings", json=payload())
    assert response.status_code == 200
    assert response.json()["target_fps"] == 8
    assert response.json()["is_active"] is False
    assert calls[-1][1] == {"is_active": False, "target_fps": 8, "jpeg_quality": 70, "detect_every": 2}
    assert client.get("/api/cameras").json()[0]["jpeg_quality"] == 70
    worker = CameraWorker(camera['id'], "Test", "sim://entrance", target_fps=8, jpeg_quality=70, detect_every=2)
    assert worker.TARGET_FPS == 8
    assert worker.DETECT_EVERY_N_FRAMES == 2
    assert worker.jpeg_quality == 70
    assert worker.recording.settings.before_seconds == 5
    assert not worker.recording.frames


@pytest.mark.parametrize("change", [{"target_fps": 0}, {"target_fps": 31}, {"jpeg_quality": 99}, {"detect_every": 0}, {"rtsp_url": "file:///etc/passwd"}])
def test_invalid_settings_do_not_change_camera(client, change):
    camera = client.post("/api/cameras", json={"name": "Entrance", "rtsp_url": "sim://entrance"}).json()
    response = client.put(f"/api/cameras/{camera['id']}/settings", json=payload(**change))
    assert response.status_code in {400, 422}
    assert client.get("/api/cameras").json()[0]["target_fps"] == 12


@pytest.mark.parametrize("role,permissions", [("viewer", []), ("operator", []), ("custom:test", ["manage_cameras"])])
def test_settings_are_admin_only(client, monkeypatch, role, permissions):
    camera = client.post("/api/cameras", json={"name": "Entrance", "rtsp_url": "sim://entrance"}).json()
    monkeypatch.setattr("app.core.security.principal_for_session", lambda token: {"role": role, "permissions": permissions})
    client.headers.pop("X-API-Key")
    response = client.put(f"/api/cameras/{camera['id']}/settings", json=payload(), headers={"X-Requested-With": "SchoolSecurity"})
    assert response.status_code == 403


def test_unchanged_source_preserves_hidden_credentials(client):
    with SessionLocal() as db:
        camera = Camera(name="Camera", rtsp_url="rtsp://user:secret@192.168.1.20/live?token=hidden")
        db.add(camera)
        db.commit()
        camera_id = camera.id
    response = client.put(f"/api/cameras/{camera_id}/settings", json=payload())
    assert response.status_code == 200
    assert "secret" not in response.text and "hidden" not in response.text
    with SessionLocal() as db:
        assert "secret" in db.get(Camera, camera_id).rtsp_url
