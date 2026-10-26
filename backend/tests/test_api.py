import io

import cv2
import numpy as np
import pytest

from app.core.config import PROJECT_ROOT, settings
from app.db.models import Camera, Violation
from app.db.session import SessionLocal


def image_bytes():
    return cv2.imencode(".jpg", np.zeros((100, 100, 3), dtype=np.uint8))[1].tobytes()


def upload(client, save=False):
    return client.post("/api/analyze/upload", files={"file": ("sample.jpg", image_bytes(), "image/jpeg")}, data={"save_violation": str(save).lower()})


def test_clean_start_has_no_demo_metrics_or_cameras(client):
    assert client.get("/health").status_code == 200
    assert client.get("/api/cameras").json() == []
    assert client.get("/api/models/jobs").json() == []
    assert client.get("/api/models/dataset").json()["total_images"] == 0


def test_api_and_media_require_authentication(client):
    result = upload(client).json()
    client.headers.pop("X-API-Key")
    assert client.get("/api/cameras").status_code == 401
    assert client.get(result["result_url"]).status_code == 401
    assert client.get("/api/cameras?api_key=" + settings.API_KEY).status_code == 401


def test_browser_session_and_csrf(client):
    client.headers.pop("X-API-Key")
    assert client.post("/api/auth/login", json={"api_key": settings.API_KEY}).status_code == 403
    headers = {"X-Requested-With": "SchoolSecurity"}
    result = client.post("/api/auth/login", json={"api_key": settings.API_KEY}, headers=headers)
    assert result.status_code == 200
    assert "HttpOnly" in result.headers["set-cookie"]
    assert "SameSite=strict" in result.headers["set-cookie"]
    assert client.get("/api/cameras").status_code == 200
    assert client.post("/api/cameras", json={"name": "Demo", "rtsp_url": "sim://hallway"}).status_code == 403
    assert client.post("/api/cameras", json={"name": "Demo", "rtsp_url": "sim://hallway"}, headers=headers).status_code == 201
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/cameras").status_code == 401


@pytest.mark.parametrize("source", ["/etc/passwd", "file:///etc/passwd", "http://169.254.169.254/latest", "http://127.0.0.1:8000", "http://[::1]", "rtsp://redis:6379", "sim://invalid"])
def test_unsafe_camera_sources_rejected(client, source):
    assert client.post("/api/cameras", json={"name": "Test", "rtsp_url": source}).status_code == 400


def test_camera_validation_and_secret_redaction(client, monkeypatch):
    monkeypatch.setattr(settings, "CAMERA_ALLOWED_HOSTS", ["192.168.1.20"])
    assert client.post("/api/cameras", json={"name": "  ", "rtsp_url": "sim://hallway"}).status_code == 422
    response = client.post("/api/cameras", json={"name": "  Real camera  ", "rtsp_url": "rtsp://user:secret@192.168.1.20/stream?token=secret"})
    assert response.status_code == 201
    assert "secret" not in response.text
    assert response.json()["name"] == "Real camera"
    assert client.post(f"/api/cameras/{response.json()['id']}/toggle").json()["is_active"] is False
    assert client.delete(f"/api/cameras/{response.json()['id']}").status_code == 204


def test_real_cameras_require_allowlist(client):
    assert client.post("/api/cameras", json={"name": "Camera", "rtsp_url": "rtsp://192.168.1.30/live"}).status_code == 400


def test_lab_not_attributed_to_surveillance_camera(client):
    cam = client.post("/api/cameras", json={"name": "Entrance", "rtsp_url": "sim://entrance"}).json()
    result = upload(client, True)
    assert result.status_code == 200
    rows = client.get("/api/violations").json()
    assert len(rows) == 1
    assert rows[0]["camera_id"] != cam["id"]
    assert "Лаборатория" in rows[0]["camera_name"]
    assert rows[0]["video_url"] == ""
    assert client.get(result.json()["result_url"]).status_code == 200
    assert len(client.get("/api/cameras").json()) == 1


def test_acknowledgement_idempotent_and_shared_media_preserved(client):
    result = upload(client, True).json()
    with SessionLocal() as db:
        row = db.query(Violation).first()
        copy = Violation(camera_id=row.camera_id, violation_type="weapon", confidence=.8, image_path=row.image_path)
        db.add(copy)
        db.commit()
        copy_id = copy.id
    row_id = result["saved_violation_ids"][0]
    for _ in range(2):
        assert client.patch(f"/api/violations/{row_id}/ack").json()["is_acknowledged"] is True
    assert client.delete(f"/api/violations/{row_id}").status_code == 204
    assert client.get(result["result_url"]).status_code == 200
    assert client.delete(f"/api/violations/{copy_id}").status_code == 204
    assert client.get(result["result_url"]).status_code == 404


def test_upload_limits_and_invalid_images(client, monkeypatch):
    monkeypatch.setattr(settings, "MAX_UPLOAD_IMAGE_MB", 1)
    assert client.post("/api/analyze/upload", files={"file": ("huge.jpg", b"x" * (2 * 1024 * 1024))}).status_code == 413
    assert client.post("/api/analyze/upload", files={"file": ("invalid.jpg", b"not an image")}).status_code == 400
    assert client.post("/api/analyze/upload", files={"file": ("invalid.exe", b"binary")}).status_code == 415


def test_training_requires_actual_labels_and_data(client):
    assert client.post("/api/models/dataset/upload", files={"file": ("img.jpg", image_bytes())}, data={"violation_type": "dog"}).status_code == 422
    assert client.post("/api/models/dataset/upload", files={"file": ("img.jpg", image_bytes())}, data={"violation_type": "dog", "bbox": "[0.5,0.5,0.2,0.3]"}).status_code == 422
    assert client.post("/api/models/retrain", json={"epochs": 1}).status_code == 422
    assert client.post("/api/models/retrain", json={"dataset_yaml": "../../etc/passwd"}).status_code == 400
    assert client.post("/api/models/jobs/999/activate").status_code == 409
    assert client.get("/api/models/jobs").json() == []


def test_pagination_bounds(client):
    assert client.get("/api/violations?limit=-1").status_code == 422
    assert client.get("/api/violations?offset=-1").status_code == 422
