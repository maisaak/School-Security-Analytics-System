from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

# ── Изолированное окружение ДО импорта приложения ───────────────────────────
_TEST_ROOT = Path(tempfile.gettempdir()) / "school_security_tests"
if _TEST_ROOT.exists():
    shutil.rmtree(_TEST_ROOT, ignore_errors=True)
_TEST_ROOT.mkdir(parents=True, exist_ok=True)

os.environ["DATABASE_URL"] = f"sqlite:///{(_TEST_ROOT / 'test.db').as_posix()}"
os.environ["MEDIA_ROOT"] = str(_TEST_ROOT / "media")
os.environ["MODEL_VERSIONS_ROOT"] = str(_TEST_ROOT / "versions")
os.environ["DEMO_LOGIN_ENABLED"] = "true"
# Снижаем нагрузку на CPU в CI: 3 демо-камеры + YOLOv8-ансамбль на 2 ядрах
os.environ["STREAM_TARGET_FPS"] = "4"
os.environ["UNATTENDED_DWELL_SEC"] = "6"

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client


def _login(username: str, password: str) -> str:
    """Логинимся отдельным клиентом, чтобы не смешивать cookie между ролями."""
    probe = TestClient(app)
    response = probe.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    token = response.cookies.get(settings.AUTH_COOKIE_NAME)
    assert token, "HttpOnly cookie с JWT не установлена"
    return token


@pytest.fixture(scope="session")
def tokens(client) -> dict[str, str]:
    return {
        "admin": _login(settings.DEMO_ADMIN_USERNAME, settings.DEMO_ADMIN_PASSWORD),
        "director": _login(settings.DEMO_DIRECTOR_USERNAME, settings.DEMO_DIRECTOR_PASSWORD),
        "guard": _login(settings.DEMO_GUARD_USERNAME, settings.DEMO_GUARD_PASSWORD),
    }


@pytest.fixture(scope="session")
def admin_headers(tokens) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['admin']}"}


@pytest.fixture(scope="session")
def director_headers(tokens) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['director']}"}


@pytest.fixture(scope="session")
def guard_headers(tokens) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['guard']}"}


@pytest.fixture(scope="session")
def first_camera(client, admin_headers) -> dict:
    cameras = client.get("/api/cameras", headers=admin_headers).json()
    assert cameras
    return cameras[0]
