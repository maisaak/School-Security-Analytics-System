"""Bounded JPEG pre-roll and timestamp-based incident clip assembly."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import threading

import cv2
import numpy as np
from pydantic import BaseModel, ConfigDict, Field


class RecordingSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    before_seconds: int = Field(default=5, ge=0, le=30, strict=True)
    after_seconds: int = Field(default=5, ge=0, le=30, strict=True)


@dataclass
class PendingClip:
    frames: list[tuple[float, bytes]]
    start: float
    end: float
    bytes_used: int


class IncidentRecording:
    # Each camera retains compressed frames, never 30 seconds of raw BGR arrays.
    MAX_BYTES = 32 * 1024 * 1024

    def __init__(self, settings: RecordingSettings):
        self.settings = settings
        self.frames: deque[tuple[float, bytes]] = deque()
        self.bytes_used = 0
        self.pending: PendingClip | None = None
        self.lock = threading.Lock()

    def configure(self, settings: RecordingSettings):
        with self.lock:
            self.settings = settings
            self.frames.clear()
            self.bytes_used = 0
            # A running clip keeps the settings captured at its trigger.

    def append(self, now: float, jpeg: bytes):
        with self.lock:
            self.frames.append((now, jpeg))
            self.bytes_used += len(jpeg)
            while self.frames and (self.frames[0][0] < now - self.settings.before_seconds or self.bytes_used > self.MAX_BYTES):
                self.bytes_used -= len(self.frames.popleft()[1])
            clip = self.pending
            if clip is not None and now <= clip.end and clip.bytes_used + len(jpeg) <= self.MAX_BYTES:
                clip.frames.append((now, jpeg))
                clip.bytes_used += len(jpeg)

    def begin(self, now: float, jpeg: bytes) -> PendingClip:
        with self.lock:
            frames = list(self.frames) or [(now, jpeg)]
            clip = PendingClip(frames, frames[0][0], now + self.settings.after_seconds, sum(len(f) for _, f in frames))
            self.pending = clip
            return clip

    def finish(self, clip: PendingClip) -> list[tuple[float, bytes]]:
        with self.lock:
            if self.pending is clip:
                self.pending = None
            return list(clip.frames)


def decode_clip(frames: list[tuple[float, bytes]], fps: float):
    """Resample real capture timestamps, so slow inference does not speed up video.

    Yield frames instead of expanding the entire clip into raw arrays in memory.
    Only the available capture interval is encoded (no invented pre-roll).
    """
    if not frames:
        return
    index = 0
    decoded = None
    last_index = -1
    count = max(1, round((frames[-1][0] - frames[0][0]) * fps) + 1)
    for step in range(count):
        timestamp = frames[0][0] + step / fps
        while index + 1 < len(frames) and frames[index + 1][0] <= timestamp:
            index += 1
        if index != last_index:
            decoded = cv2.imdecode(np.frombuffer(frames[index][1], dtype=np.uint8), cv2.IMREAD_COLOR)
            last_index = index
        if decoded is None:
            raise ValueError("Не удалось декодировать кадр инцидента")
        yield decoded
