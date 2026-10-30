"""Isolated test database/media: never touch a developer's running installation."""
import os
from pathlib import Path
import sys
import tempfile

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT)]
_temp = tempfile.TemporaryDirectory(prefix="school-tests-")
TEST_ROOT = Path(_temp.name)
os.environ.update(
    DATABASE_URL=f"sqlite:///{(TEST_ROOT / 'test.db').as_posix()}",
    MEDIA_ROOT=str(TEST_ROOT / "media"), API_KEY="test-key-" + "a" * 40,
    DEV_MODE="false", SEED_DEMO_CAMERAS="false",
    BOOTSTRAP_ADMIN_PASSWORD="",
)

from app.core.config import settings
from app.db.session import Base, engine
from app.main import app
from app.models.detector import detector
from app.services.stream_manager import stream_manager
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(stream_manager, "start_camera", lambda *a, **kw: None)
    monkeypatch.setattr(detector, "detect_frame", lambda frame: {"violations": [{"type": "dog", "confidence": 0.9, "bbox": [10, 10, 40, 40]}], "safe_objects": [], "latency_ms": 1, "person_count": 0})
    with TestClient(app) as c:
        c.headers["X-API-Key"] = settings.API_KEY
        yield c


def pytest_sessionfinish(session, exitstatus):
    stream_manager.stop_all()
    engine.dispose()
    _temp.cleanup()
