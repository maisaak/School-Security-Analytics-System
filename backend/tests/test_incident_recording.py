import cv2
import numpy as np
import pytest

from app.services.incident_recording import IncidentRecording, RecordingSettings, decode_clip


def test_pre_and_post_roll_use_capture_time_and_keep_trigger_settings():
    recorder = IncidentRecording(RecordingSettings(before_seconds=2, after_seconds=3))
    for second in range(6):
        recorder.append(second, bytes([second]))
    clip = recorder.begin(5, b"5")
    assert [t for t, _ in clip.frames] == [3, 4, 5]
    recorder.configure(RecordingSettings(before_seconds=0, after_seconds=0))
    recorder.append(6, b"6")
    recorder.append(8, b"8")
    recorder.append(9, b"9")
    assert clip.end == 8
    assert [t for t, _ in recorder.finish(clip)] == [3, 4, 5, 6, 8]
    assert recorder.pending is None


def test_zero_roll_startup_and_memory_bound():
    recorder = IncidentRecording(RecordingSettings(before_seconds=0, after_seconds=0))
    recorder.MAX_BYTES = 4
    recorder.append(1, b"11")
    clip = recorder.begin(1, b"11")
    recorder.append(2, b"22")
    assert recorder.finish(clip) == [(1, b"11")]
    recorder.configure(RecordingSettings(before_seconds=30, after_seconds=30))
    for second in range(6):
        recorder.append(second, b"22")
    assert recorder.bytes_used <= recorder.MAX_BYTES
    clip = recorder.begin(5, b"22")
    recorder.append(6, b"22")
    assert clip.bytes_used <= recorder.MAX_BYTES


def test_irregular_timestamps_resample_to_real_duration():
    def jpeg(value):
        return cv2.imencode(".jpg", np.full((16, 16, 3), value, dtype=np.uint8))[1].tobytes()
    frames = list(decode_clip([(0, jpeg(10)), (.5, jpeg(50)), (2, jpeg(100))], 4))
    assert len(frames) == 9
    assert frames[0].mean() == pytest.approx(10, abs=2)
    assert frames[-1].mean() == pytest.approx(100, abs=2)


def test_resampled_clip_encodes_with_expected_duration(tmp_path):
    from app.services.stream_manager import encode_h264_clip
    jpeg = cv2.imencode(".jpg", np.full((32, 32, 3), 100, dtype=np.uint8))[1].tobytes()
    path = tmp_path / "recording.mp4"
    encode_h264_clip(decode_clip([(0, jpeg), (1, jpeg), (2, jpeg)], 8), path, 8)
    capture = cv2.VideoCapture(str(path))
    try:
        assert capture.isOpened()
        assert capture.get(cv2.CAP_PROP_FRAME_COUNT) / capture.get(cv2.CAP_PROP_FPS) == pytest.approx(2, abs=.15)
    finally:
        capture.release()


def test_recording_api_persistence_validation_and_auth(client):
    from app.db.models import AppSetting
    from app.db.session import SessionLocal
    assert client.get("/api/recording-settings").json() == {"before_seconds": 5, "after_seconds": 5}
    payload = {"before_seconds": 3, "after_seconds": 8}
    assert client.put("/api/recording-settings", json=payload).json() == payload
    assert client.get("/api/recording-settings").json() == payload
    with SessionLocal() as db:
        assert RecordingSettings.model_validate_json(db.get(AppSetting, "incident_recording").value).model_dump() == payload
    for value in [-1, 31, 1.5, True, "5", None]:
        assert client.put("/api/recording-settings", json={**payload, "before_seconds": value}).status_code == 422
    client.headers.pop("X-API-Key")
    assert client.get("/api/recording-settings").status_code == 401
    assert client.put("/api/recording-settings", json=payload).status_code == 401


def test_non_admin_cannot_change_recording(client):
    from fastapi import Request
    from app.main import app
    from app.core.security import verify_api_key
    def viewer(request: Request):
        request.state.principal = {"role": "viewer", "permissions": ["manage_models"]}
    app.dependency_overrides[verify_api_key] = viewer
    try:
        assert client.get("/api/recording-settings").status_code == 200
        assert client.put("/api/recording-settings", json={"before_seconds": 1, "after_seconds": 1}).status_code == 403
    finally:
        app.dependency_overrides.pop(verify_api_key)
