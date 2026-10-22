from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.permissions import Permission, Role, has_permission
from app.main import app


PROTECTED_ENDPOINTS = [
    ("get", "/api/cameras"),
    ("get", "/api/violations"),
    ("get", "/api/stats"),
    ("get", "/api/audit"),
    ("get", "/api/users"),
    ("get", "/api/models/versions"),
]


def test_anonymous_access_is_rejected(client):
    for method, path in PROTECTED_ENDPOINTS:
        response = getattr(client, method)(path)
        assert response.status_code == 401, f"{path} должен требовать авторизацию, получено {response.status_code}"


def test_demo_accounts_expose_three_roles(client):
    response = client.get("/api/auth/demo-accounts")
    assert response.status_code == 200
    accounts = response.json()
    roles = {item["role"] for item in accounts}
    assert roles == {Role.ADMIN.value, Role.DIRECTOR.value, Role.GUARD.value}
    for item in accounts:
        assert item["role_label"]
        assert item["description"]
        assert item["password_hint"]


def test_login_sets_httponly_cookie_and_returns_permissions(client):
    probe = TestClient(app)
    response = probe.post(
        "/api/auth/login",
        json={"username": settings.DEMO_ADMIN_USERNAME, "password": settings.DEMO_ADMIN_PASSWORD},
    )
    assert response.status_code == 200
    assert response.json()["user"]["role"] == Role.ADMIN.value
    assert Permission.USERS_MANAGE.value in response.json()["user"]["permissions"]

    set_cookie = response.headers.get("set-cookie", "").lower()
    assert "httponly" in set_cookie
    assert settings.AUTH_COOKIE_NAME in set_cookie
    assert "samesite=lax" in set_cookie

    me = probe.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == settings.DEMO_ADMIN_USERNAME


def test_cookie_auth_works_for_binary_endpoints_and_bearer_for_api(client, tokens, warm_camera):
    first_camera = warm_camera
    """Теги <img>/<video> браузера авторизуются HttpOnly cookie, API-клиенты — Bearer-токеном."""
    probe = TestClient(app)
    login = probe.post(
        "/api/auth/login",
        json={"username": settings.DEMO_GUARD_USERNAME, "password": settings.DEMO_GUARD_PASSWORD},
    )
    assert login.status_code == 200

    # Бинарный кадр без Authorization-заголовка — только за счёт cookie
    snapshot = probe.get(f"/api/cameras/{first_camera['id']}/snapshot")
    assert snapshot.status_code == 200
    assert snapshot.headers["content-type"] == "image/jpeg"
    assert snapshot.content.startswith(b"\xff\xd8")

    # MJPEG-поток защищён так же, как и остальные камерные эндпоинты
    assert client.get(f"/api/cameras/{first_camera['id']}/stream").status_code == 401

    # ...и реально отдаётся с cookie (регрессия: кириллица в заголовке ломала стрим)
    with probe.stream("GET", f"/api/cameras/{first_camera['id']}/stream") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("multipart/x-mixed-replace")
        assert "x-camera-name" in response.headers

    bearer = client.get("/api/auth/me", headers={"Authorization": f"Bearer {tokens['guard']}"})
    assert bearer.status_code == 200
    assert bearer.json()["role"] == Role.GUARD.value


def test_wrong_password_is_rejected_and_audited(client, admin_headers):
    response = client.post(
        "/api/auth/login",
        json={"username": settings.DEMO_GUARD_USERNAME, "password": "definitely-wrong"},
    )
    assert response.status_code == 401

    audit = client.get("/api/audit", headers=admin_headers, params={"action": "auth.login_failed"})
    assert audit.status_code == 200
    assert audit.json()["total"] >= 1
    assert any(item["outcome"] == "denied" for item in audit.json()["items"])


def test_demo_login_issues_session(client):
    probe = TestClient(app)
    response = probe.post("/api/auth/demo-login", json={"username": settings.DEMO_DIRECTOR_USERNAME})
    assert response.status_code == 200
    assert response.json()["user"]["role"] == Role.DIRECTOR.value
    assert probe.get("/api/auth/me").status_code == 200

    disabled = probe.post("/api/auth/demo-login", json={"username": "not-a-demo-user"})
    assert disabled.status_code == 404


def test_logout_clears_session(client):
    probe = TestClient(app)
    probe.post(
        "/api/auth/login",
        json={"username": settings.DEMO_GUARD_USERNAME, "password": settings.DEMO_GUARD_PASSWORD},
    )
    assert probe.get("/api/cameras").status_code == 200
    assert probe.post("/api/auth/logout").status_code == 200
    assert probe.get("/api/cameras").status_code == 401


def test_disabled_account_cannot_login(client, admin_headers):
    created = client.post(
        "/api/users",
        headers=admin_headers,
        json={
            "username": "temp_director",
            "password": "TempPass123",
            "full_name": "Временный директор",
            "role": "director",
        },
    )
    assert created.status_code == 201, created.text
    user_id = created.json()["id"]

    disabled = client.patch(f"/api/users/{user_id}", headers=admin_headers, json={"is_active": False})
    assert disabled.status_code == 200
    assert disabled.json()["is_active"] is False

    login = client.post("/api/auth/login", json={"username": "temp_director", "password": "TempPass123"})
    assert login.status_code == 403

    assert client.delete(f"/api/users/{user_id}", headers=admin_headers).status_code == 204


def test_permission_matrix():
    assert has_permission(Role.ADMIN, Permission.VIOLATIONS_DELETE)
    assert has_permission(Role.ADMIN, Permission.MODELS_ROLLBACK)
    assert has_permission(Role.DIRECTOR, Permission.AUDIT_VIEW)
    assert has_permission(Role.DIRECTOR, Permission.ANALYTICS_VIEW)
    assert not has_permission(Role.DIRECTOR, Permission.VIOLATIONS_DELETE)
    assert not has_permission(Role.DIRECTOR, Permission.CAMERAS_MANAGE)
    assert not has_permission(Role.DIRECTOR, Permission.MODELS_TRAIN)
    assert has_permission(Role.GUARD, Permission.VIOLATIONS_ACK)
    assert has_permission(Role.GUARD, Permission.MEDIA_CHECK)
    assert not has_permission(Role.GUARD, Permission.AUDIT_VIEW)
    assert not has_permission(Role.GUARD, Permission.ANALYTICS_VIEW)


def test_bearer_token_fallback_without_cookies(client, warm_camera):
    first_camera = warm_camera
    """
    Регрессия для iframe-превью: браузер блокирует сторонние cookie,
    поэтому фронтенд дублирует JWT в Authorization и ?token= для медиа-тегов.
    """
    probe = TestClient(app)
    session = probe.post(
        "/api/auth/login",
        json={"username": settings.DEMO_GUARD_USERNAME, "password": settings.DEMO_GUARD_PASSWORD},
    )
    assert session.status_code == 200
    token = session.json().get("access_token")
    assert token, "Токен должен возвращаться в теле логина для fallback-режима"

    fresh = TestClient(app)  # чистый клиент без cookie
    headers = {"Authorization": f"Bearer {token}"}
    assert fresh.get("/api/auth/me", headers=headers).status_code == 200
    assert fresh.get("/api/cameras", headers=headers).status_code == 200
    assert fresh.get("/api/stats", headers=headers).status_code == 200
    assert fresh.get("/api/violations", headers=headers).status_code == 200

    snapshot = fresh.get(f"/api/cameras/{first_camera['id']}/snapshot?token={token}")
    assert snapshot.status_code == 200
    assert snapshot.headers["content-type"] == "image/jpeg"

    with fresh.stream("GET", f"/api/cameras/{first_camera['id']}/stream?token={token}") as stream:
        assert stream.status_code == 200
        assert stream.headers["content-type"].startswith("multipart/x-mixed-replace")

    assert fresh.get(f"/api/cameras/{first_camera['id']}/snapshot").status_code == 401


def test_auth_session_reports_httponly_cookie_and_token(client):
    response = client.post(
        "/api/auth/login",
        json={"username": settings.DEMO_DIRECTOR_USERNAME, "password": settings.DEMO_DIRECTOR_PASSWORD},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["token_type"] == "cookie"
    assert payload["access_token"]
    assert "httponly" in response.headers.get("set-cookie", "").lower()
