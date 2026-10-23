from __future__ import annotations

import json
import shutil
import subprocess
import threading
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
import cv2
import numpy as np

from app.core.config import settings
from app.core.detector_profiles import normalize_profile
from app.core.security import safe_delete_media_file
from app.db.models import Violation
from app.db.session import SessionLocal
from app.models.detector import detector
from app.services.event_bus import event_bus
from app.services.hls import HlsPublisher
from app.services.metrics import record_violation, set_cameras
from app.services.notifier import notify_violation
from app.services.simulator import RealisticCCTVSimulator
from app.services.tracking import BagDwellMonitor


def _resolve_ffmpeg_bin() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


FFMPEG_BIN = _resolve_ffmpeg_bin()


def encode_h264_clip(frames: list[np.ndarray], output_path: Path, fps: float = 12.0) -> None:
    """Кодирует последовательность BGR-кадров в браузерно-совместимый H.264 MP4 (yuv420p + faststart)."""
    if not frames:
        return
    output_path.parent.mkdir(parents=True, exist_ok=True)
    h, w = frames[0].shape[:2]
    # H.264 требует чётные размеры кадра
    even_w = w - (w % 2)
    even_h = h - (h % 2)

    cmd = [
        FFMPEG_BIN,
        "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", f"{even_w}x{even_h}",
        "-r", f"{fps:.2f}",
        "-i", "-",
        "-an",
        "-vcodec", "libx264",
        "-preset", "ultrafast",
        "-crf", "25",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(output_path),
    ]
    try:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        assert proc.stdin is not None
        for frm in frames:
            if frm.shape[1] != even_w or frm.shape[0] != even_h:
                frm = frm[:even_h, :even_w]
            proc.stdin.write(frm.tobytes())
        proc.stdin.close()
        proc.wait(timeout=20)
        if output_path.is_file() and output_path.stat().st_size > 512:
            return
    except Exception:
        pass

    writer = cv2.VideoWriter(str(output_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (even_w, even_h))
    for frm in frames:
        writer.write(frm[:even_h, :even_w])
    writer.release()


class CameraWorker(threading.Thread):
    """Фоновый воркер обработки одной камеры: захват кадров -> YOLOv8 -> MJPEG + запись MP4 инцидентов."""

    TARGET_FPS = 12.0
    DETECT_EVERY_N_FRAMES = 3

    @property
    def target_fps(self) -> float:
        return float(settings.STREAM_TARGET_FPS or self.TARGET_FPS)

    def __init__(
        self,
        camera_id: int,
        name: str,
        rtsp_url: str,
        phase_offset: float = 0.0,
        detector_profile: str | None = None,
        policy: dict | None = None,
    ) -> None:
        super().__init__(daemon=True)
        self.camera_id = camera_id
        self.name = name
        self.rtsp_url = rtsp_url
        # Профиль детекции: какие модели YOLO прогоняются на кадрах этой камеры
        self.detector_profile = normalize_profile(detector_profile or settings.DETECTOR_PROFILE)
        # v3: зоны ROI, порог уверенности, расписание и A/B-профиль
        self.policy: dict = policy or {}
        self.current_variant: str = "A"
        self.last_frame_monotonic: float = time.monotonic()

        self.stop_event = threading.Event()
        self.paused = False

        self.simulator = (
            RealisticCCTVSimulator(rtsp_url, phase_offset=phase_offset)
            if rtsp_url.startswith("sim://") or rtsp_url.startswith("demo://")
            else None
        )

        self.latest_jpeg: bytes | None = None
        self.latest_seq: int = 0
        self.frame_buffer: deque[np.ndarray] = deque(maxlen=54)  # ~4.5 секунды видеофрагмента
        self.last_analysis: dict = {"violations": [], "safe_objects": [], "person_count": 0, "latency_ms": 0.0}
        self.last_violation_ts: dict[str, float] = {}
        # ByteTrack-подобный трекер + таймер выдержки бесхозной сумки
        self.bag_monitor = BagDwellMonitor() if settings.TRACKER_ENABLED else None
        self.track_alert_ts: dict[str, float] = {}

        self.current_fps: float = 0.0
        self.stream_online: bool = False
        self.last_error: str | None = None

        # HLS-публикатор: аннотированные кадры -> H.264/HLS для браузерного плеера
        self.hls: HlsPublisher | None = (
            HlsPublisher(camera_id=camera_id, fps=float(settings.STREAM_TARGET_FPS or self.TARGET_FPS))
            if settings.HLS_ENABLED
            else None
        )

    def stop(self) -> None:
        self.stop_event.set()
        if self.hls is not None:
            self.hls.stop()
            self.hls = None

    def set_detector_profile(self, profile: str) -> None:
        """Горячая смена моделей без перезапуска камеры."""
        self.detector_profile = normalize_profile(profile)

    def set_policy(self, policy: dict) -> None:
        """Горячее применение зон/порогов/расписания без перезапуска потока."""
        self.policy = policy or {}

    # ── Политика камеры: зоны, порог, расписание, A/B ───────────────────────
    @property
    def zone_list(self) -> list[dict]:
        zones = self.policy.get("zones") or []
        return [z for z in zones if isinstance(z, dict) and len(z.get("points") or []) >= 3]

    def effective_confidence(self) -> float:
        raw = self.policy.get("confidence_threshold")
        if raw is None:
            return 0.0
        try:
            value = float(raw)
        except (TypeError, ValueError):
            return 0.0
        # Порог камеры может ужесточать, но не ослаблять глобальную политику
        base = settings.WEAPON_CONFIDENCE_THRESHOLD
        return max(0.0, min(max(value, base * 0.5), 0.99))

    @staticmethod
    def _point_in_polygon(points: list, cx: float, cy: float, width: int, height: int) -> bool:
        poly = np.array([[float(p[0]) * width, float(p[1]) * height] for p in points], dtype=np.float32)
        return cv2.pointPolygonTest(poly, (float(cx), float(cy)), False) >= 0

    def _zone_name_for(self, bbox: list[int], frame_shape: tuple[int, ...]) -> tuple[bool, str | None]:
        zones = self.zone_list
        if not zones:
            return True, None
        height, width = frame_shape[0], frame_shape[1]
        try:
            x1, y1, x2, y2 = [float(v) for v in bbox[:4]]
        except (TypeError, ValueError):
            return True, None
        cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
        includes = [z for z in zones if (z.get("kind") or "include") == "include"]
        excludes = [z for z in zones if (z.get("kind") or "include") == "exclude"]
        for zone in excludes:
            if self._point_in_polygon(zone.get("points") or [], cx, cy, width, height):
                return False, zone.get("name")
        if includes:
            for zone in includes:
                if self._point_in_polygon(zone.get("points") or [], cx, cy, width, height):
                    return True, zone.get("name")
            return False, None
        return True, None

    def _apply_camera_policy(self, analysis: dict, frame_shape: tuple[int, ...]) -> dict:
        threshold = self.effective_confidence()
        kept = []
        for item in analysis.get("violations", []):
            if threshold and float(item.get("confidence") or 0.0) < threshold:
                continue
            inside, zone_name = self._zone_name_for(item.get("bbox") or [], frame_shape)
            if not inside:
                continue
            item["zone_name"] = zone_name if inside else None
            kept.append(item)
        analysis["violations"] = kept
        return analysis

    def _schedule_allows(self, now: datetime | None = None) -> bool:
        schedule = self.policy.get("schedule") or {}
        if not schedule.get("enabled"):
            return True
        moment = now or datetime.now()
        days = schedule.get("days")
        if isinstance(days, list) and days and moment.weekday() not in [int(d) for d in days if str(d).lstrip("-").isdigit()]:
            return False
        start = str(schedule.get("start") or "00:00")
        end = str(schedule.get("end") or "23:59")
        current = moment.strftime("%H:%M")
        if start <= end:
            return start <= current <= end
        # Ночное окно (например, 20:00–07:00) переходит через полночь
        return current >= start or current <= end

    def _active_profile(self, frame_idx: int) -> str:
        ab_profile = self.policy.get("ab_profile")
        try:
            share = int(self.policy.get("ab_share_pct") or 0)
        except (TypeError, ValueError):
            share = 0
        if ab_profile and 0 < share < 100:
            bucket = (frame_idx * 2654435761 + self.camera_id * 97) % 100
            if bucket < share:
                self.current_variant = "B"
                return normalize_profile(ab_profile)
        self.current_variant = "A"
        return self.detector_profile

    def trigger_scenario(self, scenario: str) -> bool:
        if self.simulator is None:
            return False
        # Сбрасываем кулдаун выбранного типа, чтобы ручной тест сразу записал свежий инцидент
        self.last_violation_ts.pop(scenario, None)
        self.simulator.trigger_scenario(scenario)
        return True

    def _save_incident(
        self,
        v_type: str,
        confidence: float,
        bbox: list[int],
        snapshot: np.ndarray,
        clip_frames: list[np.ndarray],
        track_id: str | None = None,
        dwell_seconds: float | None = None,
        zone_name: str | None = None,
        model_variant: str | None = None,
    ) -> None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        img_rel = f"snapshots/cam{self.camera_id}_{v_type}_{stamp}.jpg"
        vid_rel = f"videos/cam{self.camera_id}_{v_type}_{stamp}.mp4"

        img_abs = settings.MEDIA_ROOT / img_rel
        vid_abs = settings.MEDIA_ROOT / vid_rel

        cv2.imwrite(str(img_abs), snapshot, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
        encode_h264_clip(clip_frames, vid_abs, fps=self.target_fps)

        db = SessionLocal()
        try:
            row = Violation(
                camera_id=self.camera_id,
                violation_type=v_type,
                confidence=confidence,
                bbox_json=json.dumps(bbox),
                image_path=f"/media/{img_rel}",
                video_path=f"/media/{vid_rel}",
                track_id=track_id,
                dwell_seconds=round(dwell_seconds, 2) if dwell_seconds is not None else None,
                zone_name=zone_name,
                model_variant=model_variant,
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            incident_id = row.id

            # Ротация старых записей, чтобы диск не переполнялся при 24/7 работе
            total_count = db.query(Violation).count()
            if total_count > settings.MAX_STORED_VIOLATIONS:
                stale = (
                    db.query(Violation)
                    .order_by(Violation.id.asc())
                    .limit(total_count - settings.MAX_STORED_VIOLATIONS)
                    .all()
                )
                for old_v in stale:
                    safe_delete_media_file(old_v.image_path)
                    safe_delete_media_file(old_v.video_path)
                    db.delete(old_v)
                db.commit()
        finally:
            db.close()

        # Уведомления и real-time лента — вне сессии БД, чтобы не блокировать запись
        record_violation(v_type, f"cam{self.camera_id}")
        notify_violation(incident_id)

    def _render_offline_placeholder(self, reason: str) -> bytes:
        canvas = np.zeros((540, 960, 3), dtype=np.uint8)
        canvas[:] = (22, 27, 38)
        annotated = detector.annotate_frame(
            canvas,
            {
                "violations": [],
                "safe_objects": [{"kind": "person", "label": f"ОЖИДАНИЕ ПОТОКА RTSP ({reason})", "confidence": 0.0, "bbox": [260, 250, 700, 290]}],
                "latency_ms": 0.0,
            },
            camera_title=self.name,
        )
        _, jpg = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        return jpg.tobytes()

    def run(self) -> None:
        frame_idx = 0
        fps_counter = 0
        fps_timer = time.monotonic()

        while not self.stop_event.is_set():
            if self.paused:
                self.stream_online = False
                time.sleep(0.25)
                continue

            if self.simulator is not None:
                self.stream_online = True
                self.last_error = None
                while not self.stop_event.is_set() and not self.paused:
                    loop_start = time.monotonic()
                    raw_frame = self.simulator.read_frame()
                    self._process_single_frame(raw_frame, frame_idx)
                    frame_idx += 1
                    fps_counter += 1

                    now = time.monotonic()
                    if now - fps_timer >= 1.0:
                        self.current_fps = round(fps_counter / (now - fps_timer), 1)
                        fps_counter = 0
                        fps_timer = now

                    sleep_left = (1.0 / self.target_fps) - (time.monotonic() - loop_start)
                    if sleep_left > 0:
                        time.sleep(sleep_left)
                continue

            # Реальный RTSP / HTTP / локальный видеофайл через OpenCV FFmpeg backend
            source: int | str = 0 if self.rtsp_url == "webcam" else self.rtsp_url
            cap = cv2.VideoCapture(source)
            if not cap.isOpened():
                self.stream_online = False
                self.last_error = "Не удалось подключиться к RTSP-источнику"
                self.latest_jpeg = self._render_offline_placeholder("ПЕРЕПОДКЛЮЧЕНИЕ...")
                time.sleep(2.5)
                continue

            self.stream_online = True
            self.last_error = None
            while not self.stop_event.is_set() and not self.paused:
                loop_start = time.monotonic()
                ok, raw_frame = cap.read()
                if not ok or raw_frame is None:
                    # Если это локальный видеоролик — зацикливаем для непрерывного мониторинга
                    if isinstance(source, str) and Path(source).is_file():
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        continue
                    break

                raw_frame = cv2.resize(raw_frame, (960, 540), interpolation=cv2.INTER_AREA)
                self._process_single_frame(raw_frame, frame_idx)
                frame_idx += 1
                fps_counter += 1

                now = time.monotonic()
                if now - fps_timer >= 1.0:
                    self.current_fps = round(fps_counter / (now - fps_timer), 1)
                    fps_counter = 0
                    fps_timer = now

                sleep_left = (1.0 / self.target_fps) - (time.monotonic() - loop_start)
                if sleep_left > 0:
                    time.sleep(sleep_left)

            cap.release()
            time.sleep(1.0)

    def _apply_dwell_tracking(self, analysis: dict, frame_shape: tuple[int, ...]) -> dict:
        """
        Заменяет «мгновенные» тревоги бесхозной сумки на подтверждённые трекером:
        предмет должен стабильно (>= min_hits кадров) провисеть без владельца дольше dwell-таймера.
        """
        if self.bag_monitor is None:
            return analysis
        now = time.monotonic()
        tracked = self.bag_monitor.update(
            analysis.get("bags", []),
            analysis.get("persons", []),
            frame_shape,
            now,
        )
        analysis["bag_tracks"] = tracked["states"]
        analysis["bag_dwell_threshold"] = tracked["threshold_sec"]
        analysis["violations"] = [
            v for v in analysis.get("violations", []) if v.get("type") != "suspicious_bag"
        ] + tracked["violations"]
        analysis["confirmed_bag_tracks"] = {v.get("track_id") for v in tracked["violations"]}
        return analysis

    def _process_single_frame(self, raw_frame: np.ndarray, frame_idx: int) -> None:
        if frame_idx % max(1, int(settings.DETECT_EVERY_N_FRAMES)) == 0:
            profile = self._active_profile(frame_idx)
            analysis = detector.detect_frame(raw_frame, profile=profile)
            self.last_analysis = self._apply_dwell_tracking(analysis, raw_frame.shape)
            self.last_analysis = self._apply_camera_policy(self.last_analysis, raw_frame.shape)

        annotated = detector.annotate_frame(raw_frame, self.last_analysis, camera_title=self.name)
        self.frame_buffer.append(annotated)
        if self.hls is not None:
            self.hls.push(annotated)

        ok, buf = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        if ok:
            self.latest_jpeg = buf.tobytes()
            self.latest_seq += 1

        self.last_frame_monotonic = time.monotonic()
        now = time.monotonic()
        schedule_allows = self._schedule_allows()
        for item in self.last_analysis.get("violations", []):
            if not schedule_allows:
                break
            v_type = item["type"]
            track_id = item.get("track_id")
            # Для бесхозных предметов кулдаун привязан к конкретному треку:
            # разные сумки фиксируются независимо, а одна и та же — не чаще раза в N секунд.
            cooldown_key = f"{v_type}:{track_id}" if track_id else v_type
            if now - self.track_alert_ts.get(cooldown_key, -999.0) < settings.VIOLATION_COOLDOWN_SEC:
                continue
            if track_id is None and now - self.last_violation_ts.get(v_type, -999.0) < settings.VIOLATION_COOLDOWN_SEC:
                continue

            self.track_alert_ts[cooldown_key] = now
            self.last_violation_ts[v_type] = now
            snapshot_copy = annotated.copy()
            clip_frames = list(self.frame_buffer)
            # Если буфер ещё короткий (первые секунды старта), дублируем кадры до ~2 сек, чтобы плеер проигрывал плавно
            while len(clip_frames) < 24:
                clip_frames.insert(0, snapshot_copy)
            threading.Thread(
                target=self._save_incident,
                args=(
                    v_type,
                    item["confidence"],
                    item["bbox"],
                    snapshot_copy,
                    clip_frames,
                    track_id,
                    item.get("dwell_seconds"),
                    item.get("zone_name"),
                    self.current_variant,
                ),
                daemon=True,
            ).start()


class StreamManager:
    def __init__(self) -> None:
        self._workers: dict[int, CameraWorker] = {}
        self._lock = threading.Lock()

    def start_camera(
        self,
        camera_id: int,
        name: str,
        rtsp_url: str,
        is_active: bool = True,
        detector_profile: str | None = None,
        policy: dict | None = None,
    ) -> None:
        with self._lock:
            existing = self._workers.pop(camera_id, None)
            if existing:
                existing.stop()
            offset = (camera_id * 8.5) % 26.0
            worker = CameraWorker(
                camera_id=camera_id,
                name=name,
                rtsp_url=rtsp_url,
                phase_offset=offset,
                detector_profile=detector_profile,
                policy=policy,
            )
            worker.paused = not is_active
            self._workers[camera_id] = worker
            worker.start()

    def set_detector_profile(self, camera_id: int, profile: str) -> bool:
        """Применяет новый профиль детекции к работающей камере на лету."""
        worker = self._workers.get(camera_id)
        if worker is None:
            return False
        worker.set_detector_profile(profile)
        return True

    def set_policy(self, camera_id: int, policy: dict) -> bool:
        """Горячее обновление зон, порогов, расписания и A/B на работающей камере."""
        worker = self._workers.get(camera_id)
        if worker is None:
            return False
        worker.set_policy(policy)
        return True

    def restart_camera(self, camera_id: int) -> bool:
        """Перезапуск потока с теми же параметрами (используется watchdog-ом)."""
        worker = self._workers.get(camera_id)
        if worker is None:
            return False
        self.start_camera(
            camera_id=worker.camera_id,
            name=worker.name,
            rtsp_url=worker.rtsp_url,
            is_active=not worker.paused,
            detector_profile=worker.detector_profile,
            policy=worker.policy,
        )
        return True

    def last_frame_age(self, camera_id: int) -> float | None:
        worker = self._workers.get(camera_id)
        if worker is None:
            return None
        return max(0.0, time.monotonic() - worker.last_frame_monotonic)

    def status_snapshot(self) -> list[dict]:
        with self._lock:
            workers = list(self._workers.values())
        return [
            {
                "camera_id": worker.camera_id,
                "name": worker.name,
                "online": worker.stream_online and not worker.paused,
                "paused": worker.paused,
                "fps": worker.current_fps,
                "last_frame_age_sec": round(max(0.0, time.monotonic() - worker.last_frame_monotonic), 1),
                "variant": worker.current_variant,
                "profile": worker.detector_profile,
            }
            for worker in workers
        ]

    def set_paused(self, camera_id: int, paused: bool) -> None:
        worker = self._workers.get(camera_id)
        if worker:
            worker.paused = paused

    def stop_camera(self, camera_id: int) -> None:
        with self._lock:
            worker = self._workers.pop(camera_id, None)
        if worker:
            worker.stop()
            worker.join(timeout=2.5)

    def trigger_scenario(self, camera_id: int, scenario: str) -> bool:
        worker = self._workers.get(camera_id)
        if not worker:
            return False
        return worker.trigger_scenario(scenario)

    def has_camera(self, camera_id: int) -> bool:
        return camera_id in self._workers

    def get_frame(self, camera_id: int) -> bytes | None:
        worker = self._workers.get(camera_id)
        return worker.latest_jpeg if worker else None

    def get_frame_with_seq(self, camera_id: int) -> tuple[bytes | None, int]:
        worker = self._workers.get(camera_id)
        if not worker:
            return None, -1
        return worker.latest_jpeg, worker.latest_seq

    def get_telemetry(self, camera_id: int) -> dict:
        worker = self._workers.get(camera_id)
        if not worker:
            return {
                "online": False,
                "fps": 0.0,
                "latency_ms": 0.0,
                "person_count": 0,
                "active_threats": [],
                "bag_tracking": [],
                "is_simulated": False,
                "detector_profile": normalize_profile(settings.DETECTOR_PROFILE),
                "stream_mode": "mjpeg",
                "hls_ready": False,
            }
        return {
            "online": worker.stream_online and not worker.paused,
            "fps": worker.current_fps,
            "latency_ms": worker.last_analysis.get("latency_ms", 0.0),
            "person_count": worker.last_analysis.get("person_count", 0),
            "active_threats": [v["type"] for v in worker.last_analysis.get("violations", [])],
            "bag_tracking": worker.last_analysis.get("bag_tracks", []),
            "is_simulated": worker.simulator is not None,
            "detector_profile": worker.detector_profile,
            "stream_mode": "hls" if (worker.hls is not None and worker.hls.ready()) else "mjpeg",
            "hls_ready": bool(worker.hls is not None and worker.hls.ready()),
        }

    def stop_all(self) -> None:
        with self._lock:
            workers = list(self._workers.values())
            self._workers.clear()
        for worker in workers:
            worker.stop()
        for worker in workers:
            worker.join(timeout=2.5)


stream_manager = StreamManager()
