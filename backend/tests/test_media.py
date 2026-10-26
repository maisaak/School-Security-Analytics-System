from pathlib import Path

import cv2
import numpy as np

from app.core.config import settings
from app.services.stream_manager import encode_h264_clip


def test_h264_clip_can_be_decoded(tmp_path):
    path = tmp_path / "clip.mp4"
    frames = [np.zeros((100, 100, 3), dtype=np.uint8) for _ in range(12)]
    encode_h264_clip(frames, path, 12)
    cap = cv2.VideoCapture(str(path))
    try:
        assert cap.isOpened()
        assert cap.read()[0]
        assert int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) == 12
    finally:
        cap.release()


def test_video_analysis_does_not_stop_at_90_frames(client, tmp_path):
    path = tmp_path / "input.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 12, (100, 100))
    for _ in range(96):
        writer.write(np.zeros((100, 100, 3), dtype=np.uint8))
    writer.release()
    result = client.post("/api/analyze/upload", files={"file": ("input.avi", path.read_bytes(), "video/x-msvideo")})
    assert result.status_code == 200, result.text
    assert result.json()["frames_processed"] == 96
    assert client.get(result.json()["result_url"]).status_code == 200


def test_long_video_rejected_not_silently_truncated(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "MAX_VIDEO_DURATION_SEC", 1)
    path = tmp_path / "input.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 12, (100, 100))
    for _ in range(24):
        writer.write(np.zeros((100, 100, 3), dtype=np.uint8))
    writer.release()
    assert client.post("/api/analyze/upload", files={"file": ("input.avi", path.read_bytes())}).status_code == 413
