"""Continuously drain RTSP into a single-frame buffer instead of analysing stale frames."""
from __future__ import annotations

import threading
import time

import cv2


class LatestFrameCapture:
    def __init__(self, source: str | int):
        self.source = source
        self.stop_event = threading.Event()
        self._lock = threading.Lock()
        self._frame = None
        self._seq = 0
        self._seen_seq = 0
        self._last_at = 0.0
        self.error: str | None = None
        self.worker = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self.worker.start()
        return self

    def read(self):
        with self._lock:
            if self.error or self._seq == self._seen_seq or time.monotonic() - self._last_at > 5:
                return False, None
            self._seen_seq = self._seq
            return True, self._frame

    def _run(self):
        cap = cv2.VideoCapture()
        try:
            if isinstance(self.source, str):
                opened = cap.open(self.source, cv2.CAP_FFMPEG, [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000])
            else:
                opened = cap.open(self.source)
            if not opened:
                self.error = "Не удалось подключиться к камере"
                return
            while not self.stop_event.is_set():
                ok, frame = cap.read()
                if not ok or frame is None:
                    self.error = "Поток прерван"
                    return
                with self._lock:
                    self._frame = frame
                    self._seq += 1
                    self._last_at = time.monotonic()
        except Exception:
            self.error = "Ошибка захвата видео"
        finally:
            cap.release()

    def close(self):
        self.stop_event.set()
        self.worker.join(timeout=6)
