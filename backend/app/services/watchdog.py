from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone

from app.core.config import settings
from app.db.models import Camera
from app.db.session import SessionLocal
from app.services.camera_policy import build_camera_policy
from app.services.event_bus import event_bus
from app.services.metrics import set_cameras
from app.services.notifier import notify_camera_offline
from app.services.stream_manager import stream_manager

logger = logging.getLogger("school_security.watchdog")


class CameraWatchdog(threading.Thread):
    """
    Следит за потоками камер: поднимает упавший воркер, перезапускает зависший
    поток и публикует события online/offline в SSE и метрики Prometheus.
    """

    def __init__(self) -> None:
        super().__init__(daemon=True, name="camera-watchdog")
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._state: dict[int, bool] = {}
        self.last_run: str | None = None
        self.last_actions: list[dict] = []

    def _check_once(self) -> None:
        db = SessionLocal()
        actions: list[dict] = []
        online = 0
        try:
            cameras = db.query(Camera).all()
            for cam in cameras:
                if not cam.is_active:
                    self._state[cam.id] = False
                    continue
                age = stream_manager.last_frame_age(cam.id)
                restarted = False
                if age is None:
                    stream_manager.start_camera(
                        cam.id,
                        cam.name,
                        cam.rtsp_url,
                        is_active=True,
                        detector_profile=cam.detector_profile,
                        policy=build_camera_policy(cam),
                    )
                    restarted = True
                    actions.append({"camera_id": cam.id, "action": "start_missing"})
                elif age > settings.WATCHDOG_STALE_SEC:
                    stream_manager.restart_camera(cam.id)
                    restarted = True
                    actions.append({"camera_id": cam.id, "action": "restart_stale", "age_sec": round(age, 1)})

                is_online = age is not None and age <= settings.WATCHDOG_STALE_SEC and not restarted
                if is_online:
                    online += 1
                was_online = self._state.get(cam.id)
                if was_online is not None and was_online != is_online:
                    event_bus.publish(
                        "camera.online" if is_online else "camera.offline",
                        {
                            "camera_id": cam.id,
                            "camera_name": cam.name,
                            "location": cam.location,
                            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                        },
                    )
                    if not is_online:
                        notify_camera_offline(cam.name, cam.location, online=False)
                self._state[cam.id] = is_online

            set_cameras(len([c for c in cameras if c.is_active]), online)
            self.last_run = datetime.now(timezone.utc).isoformat(timespec="seconds")
            if actions:
                self.last_actions = (actions + self.last_actions)[:20]
        finally:
            db.close()

    def start(self) -> None:
        """Перезапускаемый старт: после stop() создаём новый поток (важно для тестов и reload)."""
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self.run, daemon=True, name="camera-watchdog")
        self._thread.start()

    def run(self) -> None:
        self._stop.wait(12)
        while not self._stop.is_set():
            try:
                self._check_once()
            except Exception:
                logger.exception("Watchdog: ошибка проверки камер")
            self._stop.wait(max(3, settings.WATCHDOG_INTERVAL_SEC))

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)

    def status(self) -> dict:
        return {
            "enabled": settings.WATCHDOG_ENABLED,
            "interval_sec": settings.WATCHDOG_INTERVAL_SEC,
            "stale_sec": settings.WATCHDOG_STALE_SEC,
            "last_run": self.last_run,
            "last_actions": self.last_actions[:10],
            "workers": stream_manager.status_snapshot(),
        }


watchdog = CameraWatchdog()
