import pytest
from fastapi.testclient import TestClient

from app.api.auth import _attempts
from app.core.accounts import check_password, hash_password
from app.db.models import AppSetting
from app.db.session import SessionLocal
from app.main import app
from app.models.detector import detector


def employee(client, role="viewer", username="employee"):
    result = client.post("/api/employees", json={"username": username, "display_name": "Сотрудник", "password": "test-password-12345", "role": role})
    assert result.status_code == 201, result.text
    assert "password" not in result.text
    return result.json()


def login(username="employee"):
    _attempts.clear()
    browser = TestClient(app, headers={"X-Requested-With": "SchoolSecurity"})
    result = browser.post("/api/auth/login", json={"username": username, "password": "test-password-12345"})
    assert result.status_code == 200, result.text
    return browser


def test_password_hash_is_salted_and_verified():
    first = hash_password("секретный-пароль-123")
    assert first != hash_password("секретный-пароль-123")
    assert "секретный" not in first
    assert check_password("секретный-пароль-123", first)
    assert not check_password("wrong", first)


@pytest.mark.parametrize("role", ["viewer", "operator", "admin"])
def test_roles_enforced_server_side(client, role):
    employee(client, role)
    with login() as browser:
        assert browser.get("/api/auth/session").json()["user"]["role"] == role
        assert browser.get("/api/cameras").status_code == 200
        assert browser.get("/api/employees").status_code == (200 if role == "admin" else 403)
        assert browser.get("/api/models/jobs").status_code == (200 if role == "admin" else 403)
        assert browser.get("/api/models/dataset").status_code == (200 if role == "admin" else 403)
        result = browser.post("/api/cameras", json={"name": "Camera", "rtsp_url": "sim://hallway"})
        assert result.status_code == (201 if role == "admin" else 403)
        result = browser.post("/api/models/select", json={"model_id": "not-valid"})
        assert result.status_code == (422 if role == "admin" else 403)
        # Missing incident means authorized operator gets 404, not forbidden.
        assert browser.patch("/api/violations/999/ack").status_code == (403 if role == "viewer" else 404)
        assert browser.delete("/api/violations/999").status_code == (404 if role == "admin" else 403)


@pytest.mark.parametrize("change", [{"is_active": False}, {"password": "new-password-12345"}, {"role": "operator"}])
def test_account_changes_revoke_sessions(client, change):
    user = employee(client)
    with login() as browser:
        assert browser.get("/api/auth/session").status_code == 200
        assert client.patch(f"/api/employees/{user['id']}", json=change).status_code == 200
        assert browser.get("/api/auth/session").status_code == 401


def test_logout_revokes_copied_token(client):
    employee(client)
    with login() as browser:
        cookie = browser.cookies.get("school_session")
        assert browser.post("/api/auth/logout").status_code == 200
        browser.cookies.set("school_session", cookie)
        assert browser.get("/api/auth/session").status_code == 401


def test_preferences_are_personal_and_persist(client):
    employee(client, username="first")
    employee(client, username="second")
    with login("first") as first, login("second") as second:
        prefs = first.get("/api/preferences").json()
        prefs.update(columns=4, compact=True, show_stats=False)
        assert first.put("/api/preferences", json=prefs).status_code == 200
        assert first.get("/api/preferences").json()["columns"] == 4
        assert second.get("/api/preferences").json()["columns"] == 3
        assert client.get("/api/preferences").json()["columns"] == 3
        assert first.put("/api/preferences", json={"columns": 10}).status_code == 422


def test_duplicate_login_and_weak_password_rejected(client):
    employee(client)
    assert client.post("/api/employees", json={"username": "employee", "display_name": "Name", "password": "test-password-12345"}).status_code == 409
    assert client.post("/api/employees", json={"username": "another", "display_name": "Name", "password": "short"}).status_code == 422


def test_model_catalog_and_selection(client, monkeypatch):
    catalog = client.get("/api/models/catalog").json()
    assert len(catalog["models"]) == 10
    assert "yolo11n" in {m["id"] for m in catalog["models"]}
    assert client.post("/api/models/select", json={"model_id": "../../evil.pt"}).status_code == 422
    calls = []
    monkeypatch.setattr(detector, "select_base_model", lambda path: calls.append(path))
    assert client.post("/api/models/select", json={"model_id": "yolov8n"}).status_code == 200
    assert calls[0].name == "yolov8n.pt"
    with SessionLocal() as db:
        assert db.get(AppSetting, "base_model").value == "yolov8n.pt"


def test_failed_selection_preserves_saved_model(client, monkeypatch):
    monkeypatch.setattr("app.api.settings.download_official_weights", lambda path: None)
    def fail(path):
        raise RuntimeError("Cannot load")
    monkeypatch.setattr(detector, "select_base_model", fail)
    assert client.post("/api/models/select", json={"model_id": "yolo11n", "allow_download": True}).status_code == 503
    with SessionLocal() as db:
        assert db.get(AppSetting, "base_model") is None
