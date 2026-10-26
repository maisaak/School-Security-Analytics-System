import threading

import numpy as np

from app.services.video_capture import LatestFrameCapture


def test_latest_capture_discards_old_frames(monkeypatch):
    arrived = threading.Event()
    unblock = threading.Event()

    class FakeCapture:
        index = 0
        def open(self, *args):
            return True
        def read(self):
            self.index += 1
            if self.index > 10:
                arrived.set()
                unblock.wait(2)
                return False, None
            return True, np.full((2, 2, 3), self.index, dtype=np.uint8)
        def release(self):
            pass

    monkeypatch.setattr("app.services.video_capture.cv2.VideoCapture", FakeCapture)
    capture = LatestFrameCapture("rtsp://example").start()
    try:
        assert arrived.wait(2)
        ok, frame = capture.read()
        assert ok and int(frame[0, 0, 0]) == 10
        assert capture.read() == (False, None)
    finally:
        unblock.set()
        capture.close()
