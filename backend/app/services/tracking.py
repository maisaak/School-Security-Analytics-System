from __future__ import annotations

from dataclasses import dataclass, field
import math

from app.core.config import settings


def iou(a: list[int] | tuple[int, ...], b: list[int] | tuple[int, ...]) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(1, (a[2] - a[0]) * (a[3] - a[1]))
    area_b = max(1, (b[2] - b[0]) * (b[3] - b[1]))
    return inter / float(area_a + area_b - inter)


def center(box: list[int] | tuple[int, ...]) -> tuple[float, float]:
    return ((box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0)


@dataclass
class Track:
    """Трек объекта (ByteTrack-подобная ассоциация: IoU + прогноз скорости центра)."""

    track_id: int
    bbox: list[int]
    confidence: float
    first_seen: float
    last_seen: float
    hits: int = 1
    velocity: tuple[float, float] = (0.0, 0.0)
    observed: bool = True

    # состояние «выдержки» бесхозного предмета
    unattended_since: float | None = None
    confirmed: bool = False
    owner_near: bool = False
    dwell_seconds: float = 0.0

    def predicted_bbox(self) -> list[int]:
        vx, vy = self.velocity
        dx, dy = int(round(vx)), int(round(vy))
        return [self.bbox[0] + dx, self.bbox[1] + dy, self.bbox[2] + dx, self.bbox[3] + dy]


class IoUTracker:
    """Минималистичный ByteTrack: двухэтапная ассоциация high/low confidence + прогноз центра."""

    def __init__(
        self,
        *,
        iou_threshold: float | None = None,
        max_age_sec: float | None = None,
        min_hits: int | None = None,
    ) -> None:
        self.iou_threshold = settings.TRACK_IOU_THRESHOLD if iou_threshold is None else iou_threshold
        self.max_age_sec = settings.TRACK_MAX_AGE_SEC if max_age_sec is None else max_age_sec
        self.min_hits = settings.TRACK_MIN_HITS if min_hits is None else min_hits
        self.tracks: dict[int, Track] = {}
        self._next_id = 1

    # ── внутренняя ассоциация ────────────────────────────────────────────────
    def _associate(self, detections: list[dict], pool: list[Track]) -> list[tuple[Track, int]]:
        """Жадное сопоставление треков и детекций по IoU + нормированному смещению центра."""
        matches: list[tuple[Track, int]] = []
        used_tracks: set[int] = set()
        used_dets: set[int] = set()

        candidates: list[tuple[float, Track, int]] = []
        for track in pool:
            pred = track.predicted_bbox()
            diag = max(1.0, math.hypot(pred[2] - pred[0], pred[3] - pred[1]))
            pcx, pcy = center(pred)
            for di, det in enumerate(detections):
                score = iou(pred, det["bbox"])
                dcx, dcy = center(det["bbox"])
                norm_dist = math.hypot(pcx - dcx, pcy - dcy) / diag
                if score >= self.iou_threshold or norm_dist <= 0.6:
                    candidates.append((score - norm_dist * 0.25, track, di))

        for _, track, di in sorted(candidates, key=lambda item: item[0], reverse=True):
            if track.track_id in used_tracks or di in used_dets:
                continue
            used_tracks.add(track.track_id)
            used_dets.add(di)
            matches.append((track, di))
        return matches

    def update(self, detections: list[dict], now: float) -> list[Track]:
        dets = [d for d in detections if d.get("bbox")]
        high = [d for d in dets if float(d.get("confidence", 0.0)) >= 0.5]
        low = [d for d in dets if float(d.get("confidence", 0.0)) < 0.5]

        for track in self.tracks.values():
            track.observed = False

        pool = list(self.tracks.values())
        matches: list[tuple[Track, int]] = []
        matches += self._associate(high, pool)
        matched_track_ids = {t.track_id for t, _ in matches}
        remaining_pool = [t for t in pool if t.track_id not in matched_track_ids]
        matches += self._associate(low, remaining_pool)

        for track, di in matches:
            det = dets[di]
            new_bbox = list(det["bbox"])
            old_cx, old_cy = center(track.bbox)
            new_cx, new_cy = center(new_bbox)
            track.velocity = (
                (new_cx - old_cx) * 0.6 + track.velocity[0] * 0.4,
                (new_cy - old_cy) * 0.6 + track.velocity[1] * 0.4,
            )
            track.bbox = new_bbox
            track.confidence = float(det.get("confidence", track.confidence))
            track.last_seen = now
            track.hits += 1
            track.observed = True

        matched_det_indices = {di for _, di in matches}
        for di, det in enumerate(dets):
            if di in matched_det_indices:
                continue
            track = Track(
                track_id=self._next_id,
                bbox=list(det["bbox"]),
                confidence=float(det.get("confidence", 0.0)),
                first_seen=now,
                last_seen=now,
                hits=1,
                observed=True,
            )
            self._next_id += 1
            self.tracks[track.track_id] = track

        # забываем потерянные треки, чтобы не копить память при 24/7 работе
        for track_id, track in list(self.tracks.items()):
            if track_id not in matched_track_ids and now - track.last_seen > self.max_age_sec:
                del self.tracks[track_id]

        return [t for t in self.tracks.values() if t.observed]


@dataclass
class BagDwellMonitor:
    """
    Таймер выдержки бесхозной сумки.

    Правило: предмет считается бесхозным не в момент появления, а только если рядом
    не было владельца дольше `dwell_sec` секунд при стабильном треке (>= min_hits кадров).
    Статус удерживается во времени: короткое перекрытие детекции не сбрасывает таймер,
    а возврат владельца — сбрасывает.
    """

    dwell_sec: float = field(default_factory=lambda: settings.UNATTENDED_DWELL_SEC)
    distance_ratio: float = field(default_factory=lambda: settings.UNATTENDED_DISTANCE_RATIO)
    release_grace_sec: float = field(default_factory=lambda: settings.BAG_RELEASE_GRACE_SEC)
    tracker: IoUTracker = field(default=None)  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.tracker is None:
            self.tracker = IoUTracker()
        self.last_person_seen: float = 0.0

    def reset(self) -> None:
        self.tracker = IoUTracker()
        self.last_person_seen = 0.0

    def update(
        self,
        bags: list[dict],
        persons: list[dict],
        frame_shape: tuple[int, ...],
        now: float,
    ) -> dict:
        self.tracker.update(bags, now)
        h, w = frame_shape[:2]
        diag = math.hypot(w, h)
        person_centers = [center(p["bbox"]) for p in persons if p.get("bbox")]

        states: list[dict] = []
        violations: list[dict] = []

        for track in sorted(self.tracker.tracks.values(), key=lambda t: t.track_id):
            if not track.observed:
                # Объект временно потерян: таймер не тикает, состояние удерживается.
                # Если тревога уже была подтверждена — держим её в пределах grace-окна,
                # чтобы короткое перекрытие кадра не «мигало» на видеостене.
                states.append(self._state_payload(track, settled=True))
                if track.confirmed and (now - track.last_seen) <= self.release_grace_sec:
                    violations.append(self._violation_payload(track))
                continue

            cx, cy = center(track.bbox)
            track.owner_near = any(
                math.hypot(cx - px, cy - py) <= diag * self.distance_ratio for px, py in person_centers
            )

            if track.owner_near:
                track.unattended_since = None
                track.confirmed = False
                track.dwell_seconds = 0.0
                states.append(self._state_payload(track))
                continue

            if track.unattended_since is None:
                track.unattended_since = now

            # выдержка считается по времени последнего достоверного наблюдения
            elapsed = max(0.0, track.last_seen - track.unattended_since)
            # короткий пропуск детекции в пределах grace-окна не обнуляет таймер
            if now - track.last_seen > self.release_grace_sec:
                elapsed = max(elapsed, track.dwell_seconds)

            track.dwell_seconds = round(elapsed, 2)
            stable = track.hits >= self.tracker.min_hits
            if stable and elapsed >= self.dwell_sec:
                track.confirmed = True
            elif stable and elapsed < self.dwell_sec:
                track.confirmed = False

            states.append(self._state_payload(track))

            # Статус тревоги удерживается во времени: короткий пропуск детекции
            # в пределах grace-окна не гасит уже подтверждённую тревогу.
            if track.confirmed:
                violations.append(self._violation_payload(track))

        return {
            "states": states,
            "violations": violations,
            "threshold_sec": self.dwell_sec,
        }

    @staticmethod
    def _violation_payload(track: Track) -> dict:
        return {
            "type": "suspicious_bag",
            "confidence": round(track.confidence, 4),
            "bbox": list(track.bbox),
            "track_id": f"BAG-{track.track_id}",
            "dwell_seconds": track.dwell_seconds,
        }

    @staticmethod
    def _state_payload(track: Track, settled: bool = False) -> dict:
        if track.owner_near:
            state = "attended"
        elif track.confirmed:
            state = "unattended"
        elif track.observed:
            state = "holding"
        else:
            state = "holding" if track.unattended_since else "attended"
        return {
            "track_id": f"BAG-{track.track_id}",
            "state": state,
            "bbox": list(track.bbox),
            "confidence": round(track.confidence, 4),
            "dwell_seconds": round(track.dwell_seconds, 2),
            "hits": track.hits,
            "observed": track.observed or settled,
        }
