from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.permissions import Permission
from app.main import app


def test_guard_can_view_and_acknowledge_but_not_delete(client, guard_headers, first_camera):
    assert client.get("/api/cameras", headers=guard_headers).status_code == 200
    assert client.get("/api/violations", headers=guard_headers).status_code == 200
    assert client.get("/api/stats", headers=guard_headers).status_code == 200
    assert client.get("/api/system/status", headers=guard_headers).status_code == 200

    # Охранник подтверждает отработку — это его штатная операция
    violations = client.get("/api/violations", headers=guard_headers).json()
    if violations:
        ack = client.patch(f"/api/violations/{violations[0]['id']}/ack", headers=guard_headers)
        assert ack.status_code == 200

    # Но не удаляет улики, не управляет камерами и не видит аудит
    victim_id = violations[0]["id"] if violations else 1
    assert client.delete(f"/api/violations/{victim_id}", headers=guard_headers).status_code == 403
    assert client.delete(f"/api/cameras/{first_camera['id']}", headers=guard_headers).status_code == 403
    assert client.post(
        "/api/cameras",
        headers=guard_headers,
        json={"name": "Guard camera", "location": "x", "rtsp_url": "sim://hallway"},
    ).status_code == 403
    assert client.post(f"/api/cameras/{first_camera['id']}/toggle", headers=guard_headers).status_code == 403
    assert client.get("/api/audit", headers=guard_headers).status_code == 403
    assert client.get("/api/users", headers=guard_headers).status_code == 403
    assert client.get("/api/models/versions", headers=guard_headers).status_code == 403
    assert client.post("/api/models/retrain", headers=guard_headers, json={"epochs": 1}).status_code == 403


def test_director_has_analytics_and_audit_but_not_admin_actions(client, director_headers, first_camera):
    assert client.get("/api/stats", headers=director_headers).status_code == 200
    assert client.get("/api/audit", headers=director_headers).status_code == 200
    assert client.get("/api/audit/summary", headers=director_headers).status_code == 200
    assert client.get("/api/models/versions", headers=director_headers).status_code == 200
    assert client.get("/api/models/gate", headers=director_headers).status_code == 200

    assert client.get("/api/users", headers=director_headers).status_code == 403
    assert client.delete(f"/api/cameras/{first_camera['id']}", headers=director_headers).status_code == 403
    assert client.post("/api/models/retrain", headers=director_headers, json={"epochs": 1}).status_code == 403


def test_denied_actions_are_written_to_audit(client, admin_headers, guard_headers, first_camera):
    client.delete(f"/api/cameras/{first_camera['id']}", headers=guard_headers)
    audit = client.get(
        "/api/audit",
        headers=admin_headers,
        params={"action": "access.denied", "outcome": "denied", "limit": 100},
    )
    assert audit.status_code == 200
    payload = audit.json()
    assert payload["total"] >= 1
    denied_paths = [item["entity_id"] for item in payload["items"] if item["outcome"] == "denied"]
    assert any("/api/cameras" in (path or "") for path in denied_paths)


def test_admin_has_full_access(client, admin_headers, first_camera):
    assert client.get("/api/users", headers=admin_headers).status_code == 200
    assert client.get("/api/audit", headers=admin_headers).status_code == 200
    assert client.get("/api/models/versions", headers=admin_headers).status_code == 200
    assert client.get("/api/models/jobs", headers=admin_headers).status_code == 200
    status = client.get("/api/system/status", headers=admin_headers).json()
    assert set(status["roles"]["permissions"]) >= {
        Permission.USERS_MANAGE.value,
        Permission.MODELS_ROLLBACK.value,
        Permission.VIOLATIONS_DELETE.value,
    }


def test_admin_manages_users_and_role_changes_take_effect(client, admin_headers, tokens):
    created = client.post(
        "/api/users",
        headers=admin_headers,
        json={
            "username": "rbac_director",
            "password": "StrongPass123",
            "full_name": "Тестовый директор",
            "role": "director",
        },
    )
    assert created.status_code == 201, created.text
    user_id = created.json()["id"]

    # Дубликат логина запрещён
    duplicate = client.post(
        "/api/users",
        headers=admin_headers,
        json={"username": "rbac_director", "password": "StrongPass123", "role": "guard"},
    )
    assert duplicate.status_code == 409

    probe = TestClient(app)
    assert probe.post(
        "/api/auth/login", json={"username": "rbac_director", "password": "StrongPass123"}
    ).status_code == 200
    # Новая учётка — директор: удалять улики не может
    assert probe.delete("/api/violations/1").status_code == 403

    updated = client.patch(f"/api/users/{user_id}", headers=admin_headers, json={"role": "guard"})
    assert updated.status_code == 200
    assert updated.json()["role"] == "guard"
    assert Permission.VIOLATIONS_DELETE.value not in updated.json()["permissions"]

    assert client.delete(f"/api/users/{user_id}", headers=admin_headers).status_code == 204


def test_admin_cannot_delete_self_or_disable_self(client, admin_headers):
    me = client.get("/api/auth/me", headers=admin_headers).json()
    assert client.delete(f"/api/users/{me['id']}", headers=admin_headers).status_code == 409
    assert client.patch(
        f"/api/users/{me['id']}", headers=admin_headers, json={"is_active": False}
    ).status_code == 409
