"""Per-camera temporal confirmation. This is a heuristic, not owner identification."""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class Track:
    bbox: list[int]
    first_seen: float
    last_seen: float
    hits: int = 1
    anchor: list[int] | None = None


class EventPolicy:
    def __init__(self, bag_seconds: float, confirmations: int = 2, max_gap: float = 2.0):
        self.bag_seconds = bag_seconds
        self.confirmations = confirmations
        self.max_gap = max_gap
        self.tracks: dict[str, list[Track]] = {}

    def reset(self) -> None:
        self.tracks.clear()

    def update(self, analysis: dict, now: float) -> dict:
        result = {**analysis, "violations": [], "safe_objects": list(analysis.get("safe_objects", []))}
        next_tracks: dict[str, list[Track]] = {}
        used: set[int] = set()
        for item in analysis.get("violations", []):
            kind, box = item["type"], item["bbox"]
            cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
            # Bags must stay approximately stationary; moving detections restart the timer.
            tolerance = max(12.0, math.hypot(box[2] - box[0], box[3] - box[1]) * (0.25 if kind == "suspicious_bag" else 0.75))
            previous = None
            for track in self.tracks.get(kind, []):
                reference = track.anchor if kind == "suspicious_bag" and track.anchor else track.bbox
                tx, ty = (reference[0] + reference[2]) / 2, (reference[1] + reference[3]) / 2
                if id(track) not in used and now - track.last_seen <= self.max_gap and math.hypot(cx - tx, cy - ty) <= tolerance:
                    previous = track
                    used.add(id(track))
                    break
            track = Track(box, previous.first_seen if previous else now, now, previous.hits + 1 if previous else 1, previous.anchor if previous else list(box))
            next_tracks.setdefault(kind, []).append(track)
            elapsed = now - track.first_seen
            if track.hits >= self.confirmations and (kind != "suspicious_bag" or elapsed >= self.bag_seconds):
                result["violations"].append(item)
            else:
                label = f"СУМКА · НАБЛЮДЕНИЕ {elapsed:.0f}/{self.bag_seconds:.0f} с" if kind == "suspicious_bag" else "ПРОВЕРКА ОБЪЕКТА"
                result["safe_objects"].append({**item, "kind": "pending", "label": label})
        # Missing or attended bags reset immediately: no accumulated time across disconnected observations.
        self.tracks = next_tracks
        return result
