"""Opt-in local HTTP smoke test: adds and finally removes its own demo camera."""
from pathlib import Path
import time

import httpx
from dotenv import dotenv_values

root = Path(__file__).resolve().parents[1]
key = dotenv_values(root / ".env").get("API_KEY")
camera_id = None
with httpx.Client(base_url="http://localhost:3000", timeout=30, headers={"X-Requested-With": "SchoolSecurity"}) as client:
    assert client.get("/api/cameras").status_code == 401
    assert client.post("/api/auth/login", json={"api_key": key}).status_code == 200
    assert client.get("/api/auth/session").status_code == 200
    response = client.post("/api/cameras", json={"name": "Smoke test (temporary)", "rtsp_url": "sim://courtyard"})
    response.raise_for_status()
    camera_id = response.json()["id"]
    try:
        client.post(f"/api/cameras/{camera_id}/simulate", json={"scenario": "dog"}).raise_for_status()
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            response = client.get(f"/api/violations?camera_id={camera_id}&violation_type=dog")
            response.raise_for_status()
            rows = response.json()
            if rows:
                break
            time.sleep(.3)
        assert rows, "No dog incident from actual camera/inference pipeline"
        row = rows[0]
        assert row["camera_id"] == camera_id and row["violation_type"] == "dog"
        image = client.get(row["image_path"])
        assert image.status_code == 200 and image.headers["content-type"].startswith("image/")
        video = client.get(row["video_url"])
        assert video.status_code == 200 and len(video.content) > 512
        with client.stream("GET", f"/api/cameras/{camera_id}/stream") as stream:
            assert stream.status_code == 200
            assert b"--frame" in next(stream.iter_bytes())
        print("Live smoke passed: session, actual YOLO camera, matching incident, protected photo, H.264 clip, MJPEG.")
    finally:
        client.delete(f"/api/cameras/{camera_id}").raise_for_status()
    client.post("/api/auth/logout").raise_for_status()
    assert client.get("/api/cameras").status_code == 401
    print("Temporary camera/archive removed; logout verified.")
