from datetime import datetime, timezone
from io import BytesIO

import pytest
from PIL import Image
from pydantic import ValidationError

from app.services.camera_rules import CameraRules, filter_analysis, is_active


def test_schedule_overnight_start_day():
    rules = CameraRules(schedule={"enabled": True, "timezone": "UTC", "windows": [{"weekdays": [0], "start": "22:00", "end": "02:00"}]})
    assert is_active(rules, datetime(2026, 10, 27, 1, tzinfo=timezone.utc))
    assert not is_active(rules, datetime(2026, 10, 28, 1, tzinfo=timezone.utc))
    assert not is_active(rules, datetime(2026, 10, 27, 2, tzinfo=timezone.utc))


def test_class_and_exclusion_precedence():
    square = [[0, 0], [1, 0], [1, 1], [0, 1]]
    rules = CameraRules(enabled_classes=["dog"], zones=[{"id": "in", "name": "in", "mode": "include", "points": square}, {"id": "out", "name": "out", "mode": "exclude", "points": [[0, 0], [.5, 0], [.5, .5], [0, .5]]}])
    detections = [{"type": kind, "bbox": box} for kind, box in [("weapon", [60, 60, 80, 80]), ("dog", [10, 10, 20, 20]), ("dog", [60, 60, 80, 80])]]
    assert filter_analysis({"violations": detections}, rules, 100, 100)["violations"] == detections[2:]


def test_schedule_disabled_and_empty_enabled_have_opposite_meaning():
    now = datetime(2026, 10, 26, 12, tzinfo=timezone.utc)
    assert is_active(CameraRules(schedule={"enabled": False, "timezone": "UTC", "windows": []}), now)
    assert not is_active(CameraRules(schedule={"enabled": True, "timezone": "UTC", "windows": []}), now)


@pytest.mark.parametrize("hour,minute,expected", [(7, 59, False), (8, 0, True), (16, 59, True), (17, 0, False)])
def test_schedule_half_open_daytime_interval(hour, minute, expected):
    rules = CameraRules(schedule={"enabled": True, "timezone": "UTC", "windows": [{"weekdays": [0], "start": "08:00", "end": "17:00"}]})
    assert is_active(rules, datetime(2026, 10, 26, hour, minute, tzinfo=timezone.utc)) is expected


def test_schedule_applies_timezone_before_weekday():
    rules = CameraRules(schedule={"enabled": True, "timezone": "Europe/Moscow", "windows": [{"weekdays": [0], "start": "00:00", "end": "02:00"}]})
    # Sunday UTC is already Monday in the camera's configured timezone.
    assert is_active(rules, datetime(2026, 10, 25, 22, tzinfo=timezone.utc))
    assert not is_active(rules, datetime(2026, 10, 25, 23, tzinfo=timezone.utc))


@pytest.mark.parametrize("points", [
    [[0, 0], [1, 1], [0, 1], [1, 0]],
    [[0, 0], [1, 0], [1, 1], [0, 0]],
    [[0, 0], [1.01, 0], [0, 1]],
])
def test_ambiguous_or_out_of_frame_polygons_are_rejected(points):
    with pytest.raises(ValidationError):
        CameraRules(zones=[{"id": "invalid", "name": "Invalid", "mode": "include", "points": points}])


@pytest.mark.parametrize("payload", [
    {"schedule": {"timezone": "No/SuchZone"}},
    {"schedule": {"windows": [{"weekdays": [0], "start": "01:00", "end": "01:00"}]}},
    {"zones": [{"id": "a", "name": "a", "mode": "include", "points": [[0, 0], [1, 1], [.5, .5]]}]},
])
def test_invalid_rules(payload):
    with pytest.raises(ValidationError):
        CameraRules(**payload)


def test_plans_roundtrip_and_auth(client):
    image = BytesIO()
    Image.new("RGB", (20, 30)).save(image, "PNG")
    response = client.post("/api/floor-plans", data={"name": "Floor"}, files={"file": ("plan.png", image.getvalue(), "image/png")})
    assert response.status_code == 201, response.text
    plan = response.json()
    assert (plan["width"], plan["height"]) == (20, 30)
    assert client.get(plan["image_url"]).status_code == 200
    assert client.put(f"/api/floor-plans/{plan['id']}/placements", json={"placements": [{"camera_id": 9999, "x": .5, "y": .5}]}).status_code == 404
    assert client.delete(f"/api/floor-plans/{plan['id']}").status_code == 200
    assert client.get("/api/floor-plans").json() == []
    client.headers.pop("X-API-Key")
    assert client.get("/api/floor-plans").status_code == 401


def test_probe_contract_stub(client, monkeypatch):
    from app.api import monitoring
    monkeypatch.setattr(monitoring, "probe_stream", lambda source: {"ok": False, "latency_ms": 8000, "width": None, "height": None, "preview_data_url": None, "error_code": "timeout", "message": "Timeout"})
    assert client.post("/api/cameras/probe", json={"rtsp_url": "sim://entrance"}).json()["error_code"] == "timeout"
    assert client.post("/api/cameras/probe", json={"rtsp_url": "sim://entrance", "camera_id": 1}).status_code == 422


def test_probe_timeout_kills_child(monkeypatch):
    import subprocess
    from app.services import camera_probe
    class Child:
        killed = False
        def communicate(self, *args, **kwargs):
            if not self.killed:
                raise subprocess.TimeoutExpired("probe", 8)
        def kill(self):
            self.killed = True
    child = Child()
    monkeypatch.setattr(camera_probe.subprocess, "Popen", lambda *a, **kw: child)
    assert camera_probe.probe_stream("sim://entrance")["error_code"] == "timeout"
    assert child.killed


def test_probe_real_child_simulation_and_rejected_source():
    from app.services.camera_probe import probe_stream
    response = probe_stream("sim://entrance")
    assert response["ok"], response
    assert (response["width"], response["height"]) == (960, 540)
    assert response["preview_data_url"].startswith("data:image/jpeg;base64,")
    rejected = probe_stream("file:///forbidden")
    assert not rejected["ok"] and rejected["error_code"] == "rejected"
    assert probe_stream("demo://school-entrance")["ok"]


def test_strict_admin(client, monkeypatch):
    from app.api.monitoring import verify_api_key
    from app.main import app
    def viewer(request):
        request.state.principal = {"role": "viewer", "permissions": ["manage_models"]}
    from fastapi import Request
    viewer.__annotations__["request"] = Request
    app.dependency_overrides[verify_api_key] = viewer
    try:
        assert client.post("/api/cameras/probe", json={"rtsp_url": "sim://entrance"}).status_code == 403
        assert client.put("/api/cameras/1/rules", json={}).status_code == 403
        assert client.get("/api/floor-plans").status_code == 200
        assert client.post("/api/floor-plans", data={"name": "Forbidden"}, files={"file": ("plan.png", b"invalid", "image/png")}).status_code == 403
        assert client.put("/api/floor-plans/missing/placements", json={"placements": []}).status_code == 403
        assert client.delete("/api/floor-plans/missing").status_code == 403
    finally:
        app.dependency_overrides.pop(verify_api_key)


def test_rules_persist_into_recreated_worker_and_reset_on_schedule(client, monkeypatch):
    import numpy as np
    from app.services.stream_manager import CameraWorker
    from app.models.detector import detector
    camera = client.post("/api/cameras", json={"name": "Rules camera", "rtsp_url": "sim://entrance"}).json()
    rules = CameraRules(enabled_classes=["dog"], schedule={"enabled": True, "timezone": "UTC", "windows": []})
    response = client.put(f"/api/cameras/{camera['id']}/rules", json=rules.model_dump())
    assert response.status_code == 200
    assert client.get(f"/api/cameras/{camera['id']}/rules").json() == rules.model_dump()
    worker = CameraWorker(camera["id"], "Rules camera", "sim://entrance")
    assert worker.rules == rules
    worker.last_analysis = {"violations": [{"type": "dog"}]}
    monkeypatch.setattr(detector, "annotate_frame", lambda frame, *a, **kw: frame)
    monkeypatch.setattr(detector, "detect_frame", lambda *a: pytest.fail("Inactive schedule must not run detection"))
    worker._process_single_frame(np.zeros((20, 30, 3), dtype=np.uint8), 3)
    assert worker.last_analysis["violations"] == []


def test_delete_camera_cleans_rules_and_plan_placements(client):
    from app.db.models import AppSetting
    from app.db.session import SessionLocal
    import json
    cam = client.post("/api/cameras", json={"name": "Temporary", "rtsp_url": "sim://entrance"}).json()
    client.put(f"/api/cameras/{cam['id']}/rules", json={"enabled_classes": []})
    with SessionLocal() as db:
        db.add(AppSetting(key="floor_plans", value=json.dumps([{"id": "plan", "placements": [{"camera_id": cam["id"], "x": .5, "y": .5}]}])))
        db.commit()
    assert client.delete(f"/api/cameras/{cam['id']}").status_code == 204
    with SessionLocal() as db:
        assert db.get(AppSetting, f"camera_rules:{cam['id']}") is None
        assert json.loads(db.get(AppSetting, "floor_plans").value)[0]["placements"] == []


@pytest.mark.parametrize("coordinate", [-0.01, 1.01, "NaN", "Infinity"])
def test_plan_placement_rejects_invalid_coordinate(client, coordinate):
    response = client.put("/api/floor-plans/missing/placements", json={"placements": [{"camera_id": 1, "x": coordinate, "y": .5}]})
    assert response.status_code == 422


def test_plan_duplicate_placement_rejected_without_changing_saved_plan(client):
    camera = client.post("/api/cameras", json={"name": "Plan camera", "rtsp_url": "sim://entrance"}).json()
    image = BytesIO()
    Image.new("RGB", (24, 16)).save(image, "PNG")
    plan = client.post("/api/floor-plans", data={"name": "Test plan"}, files={"file": ("plan.png", image.getvalue(), "image/png")}).json()
    marker = {"camera_id": camera["id"], "x": 0, "y": 1}
    path = f"/api/floor-plans/{plan['id']}/placements"
    assert client.put(path, json={"placements": [marker]}).status_code == 200
    assert client.put(path, json={"placements": [marker, marker]}).status_code == 422
    saved = client.get("/api/floor-plans").json()
    assert next(item for item in saved if item["id"] == plan["id"])["placements"] == [marker]


@pytest.mark.parametrize("payload", [b"not-an-image", b"<svg xmlns='http://www.w3.org/2000/svg'></svg>"])
def test_plan_content_not_trusted_from_filename_or_mime(client, payload):
    before = client.get("/api/floor-plans").json()
    response = client.post("/api/floor-plans", data={"name": "Invalid"}, files={"file": ("plan.png", payload, "image/png")})
    assert response.status_code == 400
    assert client.get("/api/floor-plans").json() == before
