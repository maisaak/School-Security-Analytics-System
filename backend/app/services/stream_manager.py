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
from app.db.models import Violation
from app.db.session import SessionLocal
from app.models.detector import detector
from app.services.simulator import RealisticCCTVSimulator


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

    def __init__(self, camera_id: int, name: str, rtsp_url: str, phase_offset: float = 0.0) -> None:
        super().__init__(daemon=True)
        self.camera_id = camera_id
        self.name = name
        self.rtsp_url = rtsp_url

        self.stop_event = threading.Event()
        self.paused = False

        self.simulator = (
            RealisticCCTVSimulator(rtsp_url, phase_offset=phase_offset)
            if rtsp_url.startswith("sim://") or rtsp_url.startswith("demo://")
            else None
        )

        self.latest_jpeg: bytes | None = None
        self.frame_buffer: deque[np.ndarray] = deque(maxlen=54)  # ~4.5 секунды видеофрагмента
        self.last_analysis: dict = {"violations": [], "safe_objects": [], "person_count": 0, "latency_ms": 0.0}
        self.last_violation_ts: dict[str, float] = {}

        self.current_fps: float = 0.0
        self.stream_online: bool = False
        self.last_error: str | None = None

    def stop(self) -> None:
        self.stop_event.set()

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
    ) -> None:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        img_rel = f"snapshots/cam{self.camera_id}_{v_type}_{stamp}.jpg"
        vid_rel = f"videos/cam{self.camera_id}_{v_type}_{stamp}.mp4"

        img_abs = settings.MEDIA_ROOT / img_rel
        vid_abs = settings.MEDIA_ROOT / vid_rel

        cv2.imwrite(str(img_abs), snapshot, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
        encode_h264_clip(clip_frames, vid_abs, fps=self.TARGET_FPS)

        db = SessionLocal()
        try:
            row = Violation(
                camera_id=self.camera_id,
                violation_type=v_type,
                confidence=confidence,
                bbox_json=json.dumps(bbox),
                image_path=f"/media/{img_rel}",
                video_path=f"/media/{vid_rel}",
            )
            db.add(row)
            db.commit()
        finally:
            db.close()

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

                    sleep_left = (1.0 / self.TARGET_FPS) - (time.monotonic() - loop_start)
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

                sleep_left = (1.0 / self.TARGET_FPS) - (time.monotonic() - loop_start)
                if sleep_left > 0:
                    time.sleep(sleep_left)

            cap.release()
            time.sleep(1.0)

    def _process_single_frame(self, raw_frame: np.ndarray, frame_idx: int) -> None:
        if frame_idx % self.DETECT_EVERY_N_FRAMES == 0:
            self.last_analysis = detector.detect_frame(raw_frame)

        annotated = detector.annotate_frame(raw_frame, self.last_analysis, camera_title=self.name)
        self.frame_buffer.append(annotated)

        ok, buf = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        if ok:
            self.latest_jpeg = buf.tobytes()

        now = time.monotonic()
        for item in self.last_analysis.get("violations", []):
            v_type = item["type"]
            if now - self.last_violation_ts.get(v_type, -999.0) >= settings.VIOLATION_COOLDOWN_SEC:
                self.last_violation_ts[v_type] = now
                snapshot_copy = annotated.copy()
                clip_frames = list(self.frame_buffer)
                # Если буфер ещё короткий (первые секунды старта), дублируем кадры до ~2 сек, чтобы плеер проигрывал плавно
                while len(clip_frames) < 24:
                    clip_frames.insert(0, snapshot_copy)
                threading.Thread(
                    target=self._save_incident,
                    args=(v_type, item["confidence"], item["bbox"], snapshot_copy, clip_frames),
                    daemon=True,
                ).start()


class StreamManager:
    def __init__(self) -> None:
        self._workers: dict[int, CameraWorker] = {}
        self._lock = threading.Lock()

    def start_camera(self, camera_id: int, name: str, rtsp_url: str, is_active: bool = True) -> None:
        with self._lock:
            existing = self._workers.pop(camera_id, None)
            if existing:
                existing.stop()
            offset = (camera_id * 8.5) % 26.0
            worker = CameraWorker(camera_id=camera_id, name=name, rtsp_url=rtsp_url, phase_offset=offset)
            worker.paused = not is_active
            self._workers[camera_id] = worker
            worker.start()

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

    def get_frame(self, camera_id: int) -> bytes | None:
        worker = self._workers.get(camera_id)
        return worker.latest_jpeg if worker else None

    def get_telemetry(self, camera_id: int) -> dict:
        worker = self._workers.get(camera_id)
        if not worker:
            return {
                "online": False,
                "fps": 0.0,
                "latency_ms": 0.0,
                "person_count": 0,
                "active_threats": [],
                "is_simulated": False,
            }
        return {
            "online": worker.stream_online and not worker.paused,
            "fps": worker.current_fps,
            "latency_ms": worker.last_analysis.get("latency_ms", 0.0),
            "person_count": worker.last_analysis.get("person_count", 0),
            "active_threats": [v["type"] for v in worker.last_analysis.get("violations", [])],
            "is_simulated": worker.simulator is not None,
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
