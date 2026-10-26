"""Small actual-model smoke test. It is NOT a detector accuracy benchmark."""
import cv2

from app.core.config import PROJECT_ROOT
from app.models.detector import detector


def test_real_yolo_detects_example_dog():
    frame = cv2.imread(str(PROJECT_ROOT / "ml/assets/sprites/dog_white.png"))
    assert frame is not None
    result = detector.detect_frame(frame)
    assert any(v["type"] == "dog" for v in result["violations"])
    assert result["latency_ms"] > 0
