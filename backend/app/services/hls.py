from __future__ import annotations

import logging
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

import numpy as np

from app.core.config import settings

logger = logging.getLogger("school_security.hls")

SEGMENT_NAME_RE = re.compile(r"^seg\d{3,6}\.ts$")
PLAYLIST_NAME = "index.m3u8"


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


def camera_hls_dir(camera_id: int) -> Path:
    return settings.MEDIA_ROOT / "hls" / f"cam{int(camera_id)}"


def playlist_path(camera_id: int) -> Path:
    return camera_hls_dir(camera_id) / PLAYLIST_NAME


def playlist_ready(camera_id: int, max_age_sec: float = 8.0) -> bool:
    """Плейлист существует и обновлялся недавно — значит сегменты реально пишутся."""
    path = playlist_path(camera_id)
    try:
        if not path.is_file() or path.stat().st_size == 0:
            return False
        return (time.time() - path.stat().st_mtime) <= max_age_sec
    except OSError:
        return False


def resolve_segment(camera_id: int, name: str) -> Path | None:
    """Защита от path traversal: отдаём только файлы вида seg00012.ts из каталога камеры."""
    if not SEGMENT_NAME_RE.match(name or ""):
        return None
    path = camera_hls_dir(camera_id) / name
    return path if path.is_file() else None


def cleanup_camera_hls(camera_id: int) -> None:
    target = camera_hls_dir(camera_id)
    if target.is_dir():
        shutil.rmtree(target, ignore_errors=True)


class HlsPublisher:
    """
    Публикует аннотированные кадры камеры как HLS-поток.

    Схема: worker камеры отдаёт готовый BGR-кадр (с рамками YOLO и HUD) ->
    отдельный поток кладёт сырые кадры в stdin ffmpeg -> ffmpeg кодирует H.264
    и режет на mpeg-ts сегменты -> браузер играет плейлист через hls.js.

    Так RTSP-камера воспроизводится нормальным видеоплеером, а не MJPEG-перерисовкой
    <img>, и при этом детекция остаётся видимой поверх картинки.
    """

    def __init__(
        self,
        camera_id: int,
        fps: float = 12.0,
        segment_sec: float | None = None,
        max_segments: int | None = None,
    ) -> None:
        self.camera_id = int(camera_id)
        self.fps = max(4.0, float(fps or 12.0))
        self.segment_sec = float(segment_sec or settings.HLS_SEGMENT_SEC)
        self.max_segments = int(max_segments or settings.HLS_MAX_SEGMENTS)
        self.root = camera_hls_dir(self.camera_id)
        self.playlist = self.root / PLAYLIST_NAME

        self._latest: np.ndarray | None = None
        self._latest_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._proc: subprocess.Popen | None = None
        self._size: tuple[int, int] | None = None
        self.frames_written = 0
        self.last_error: str | None = None
        self.started_at: float | None = None

    # ── Публичный интерфейс ────────────────────────────────────────────────
    def push(self, frame: np.ndarray) -> None:
        """Кладёт последний кадр (старые не копим — для живого потока важна свежесть)."""
        if not settings.HLS_ENABLED or frame is None:
            return
        with self._latest_lock:
            self._latest = frame
        if self._thread is None or not self._thread.is_alive():
            self.root.mkdir(parents=True, exist_ok=True)
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._loop, name=f"hls-cam{self.camera_id}", daemon=True
            )
            self._thread.start()

    def ready(self, max_age_sec: float = 8.0) -> bool:
        return playlist_ready(self.camera_id, max_age_sec=max_age_sec)

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None
        self._kill_ffmpeg()
        cleanup_camera_hls(self.camera_id)

    # ── Внутренняя механика ───────────────────────────────────────────────
    def _take_frame(self) -> np.ndarray | None:
        with self._latest_lock:
            frame = self._latest
            self._latest = None
        return frame

    def _kill_ffmpeg(self) -> None:
        proc = self._proc
        self._proc = None
        if proc is None:
            return
        try:
            if proc.stdin:
                proc.stdin.close()
        except Exception:
            pass
        try:
            proc.terminate()
            proc.wait(timeout=2.0)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    def _spawn_ffmpeg(self, width: int, height: int) -> subprocess.Popen | None:
        even_w = width - (width % 2)
        even_h = height - (height % 2)
        gop = max(1, int(round(self.fps)))

        cmd = [
            FFMPEG_BIN,
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            # Вход: сырые BGR-кадры из памяти процесса
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{even_w}x{even_h}",
            "-r", f"{self.fps:.2f}",
            "-i", "-",
            # Выход: H.264 + HLS
            "-an",
            "-c:v", settings.HLS_VIDEO_CODEC,
            "-preset", "ultrafast",
            "-tune", "zerolatency",
            "-pix_fmt", "yuv420p",
            # main-профиль понимают все браузерные декодеры (Chrome/Edge/Safari/Firefox)
            "-profile:v", "main",
            "-g", str(gop),
            "-keyint_min", str(gop),
            "-sc_threshold", "0",
            "-b:v", "2200k",
            "-maxrate", "2600k",
            "-bufsize", "3000k",
            "-f", "hls",
            "-hls_time", f"{self.segment_sec:.2f}",
            "-hls_list_size", str(self.max_segments),
            "-hls_flags", "delete_segments+omit_endlist+independent_segments+program_date_time",
            "-hls_segment_filename", str(self.root / "seg%05d.ts"),
            str(self.playlist),
        ]
        try:
            return subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
        except Exception as exc:
            self.last_error = f"ffmpeg не запустился: {exc}"
            logger.warning("HLS cam%s: %s", self.camera_id, self.last_error)
            return None

    def _loop(self) -> None:
        self.started_at = time.time()
        frame_interval = 1.0 / self.fps
        empty_polls = 0

        while not self._stop.is_set():
            frame = self._take_frame()
            if frame is None:
                empty_polls += 1
                if empty_polls > int(self.fps * 6):
                    break  # камера перестала давать кадры — поток закрываем
                time.sleep(min(frame_interval, 0.05))
                continue
            empty_polls = 0

            height, width = frame.shape[:2]
            if self._size != (width, height):
                self._kill_ffmpeg()
                self._size = (width, height)
            if self._proc is None:
                self._proc = self._spawn_ffmpeg(width, height)
                if self._proc is None:
                    time.sleep(1.0)
                    continue

            started = time.monotonic()
            try:
                even_h = height - (height % 2)
                even_w = width - (width % 2)
                payload = frame if (even_w, even_h) == (width, height) else frame[:even_h, :even_w]
                assert self._proc.stdin is not None
                self._proc.stdin.write(np.ascontiguousarray(payload).tobytes())
                self._proc.stdin.flush()
                self.frames_written += 1
                self.last_error = None
            except Exception as exc:
                self.last_error = f"ffmpeg pipe: {exc}"
                self._kill_ffmpeg()
                time.sleep(0.5)
                continue

            # Держим реальный темп: видео должно идти со скоростью 1x
            sleep_left = frame_interval - (time.monotonic() - started)
            if sleep_left > 0:
                time.sleep(sleep_left)

        self._kill_ffmpeg()
