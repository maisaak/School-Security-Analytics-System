from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import safe_delete_media_file
from app.db.models import Violation
from app.db.session import SessionLocal
from app.services.event_bus import event_bus
from app.services.runtime_state import load_retention, save_retention

logger = logging.getLogger("school_security.retention")


def directory_size_bytes(root: Path) -> int:
    total = 0
    if not root.exists():
        return 0
    for path in root.rglob("*"):
        try:
            if path.is_file():
                total += path.stat().st_size
        except OSError:
            continue
    return total


def _aware(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _delete_rows(db: Session, rows: list[Violation]) -> int:
    for row in rows:
        safe_delete_media_file(row.image_path)
        safe_delete_media_file(row.video_path)
        db.delete(row)
    if rows:
        db.commit()
    return len(rows)


def cleanup_orphan_media(max_age_days: int = 3) -> int:
    """Удаляет файлы, на которые больше не ссылается ни одна запись журнала."""
    db = SessionLocal()
    removed = 0
    try:
        referenced = {
            str(path)
            for (path,) in db.query(Violation.image_path).all()
        } | {str(path) for (path,) in db.query(Violation.video_path).all()}
        cutoff = time.time() - max_age_days * 86400
        for sub in ("snapshots", "videos"):
            folder = settings.MEDIA_ROOT / sub
            if not folder.exists():
                continue
            for path in folder.glob("*"):
                if not path.is_file():
                    continue
                rel = f"/media/{path.relative_to(settings.MEDIA_ROOT).as_posix()}"
                try:
                    if rel not in referenced and path.stat().st_mtime < cutoff:
                        path.unlink(missing_ok=True)
                        removed += 1
                except OSError:
                    continue
    finally:
        db.close()
    return removed


def run_cleanup(db: Session | None = None, *, days: int | None = None, max_gb: float | None = None) -> dict:
    """Применяет политику хранения: срок жизни записей и квоту диска."""
    own = db is None
    session = db or SessionLocal()
    policy = load_retention(db=session)
    keep_days = max(1, int(days if days is not None else policy["days"]))
    quota_gb = max(0.1, float(max_gb if max_gb is not None else policy["max_gb"]))
    started = time.perf_counter()

    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=keep_days)
        expired = (
            session.query(Violation)
            .filter(Violation.detected_at < cutoff)
            .order_by(Violation.detected_at.asc())
            .all()
        )
        deleted_expired = _delete_rows(session, expired)

        usage_bytes = directory_size_bytes(settings.MEDIA_ROOT)
        quota_bytes = int(quota_gb * 1024**3)
        deleted_quota = 0
        # При переполнении квоты удаляем самые старые записи, но не трогаем
        # неподтверждённые тревоги за последние сутки — это потенциальные улики.
        protected_after = datetime.now(timezone.utc) - timedelta(hours=24)
        while usage_bytes > quota_bytes:
            oldest = (
                session.query(Violation)
                .filter(
                    (Violation.is_acknowledged.is_(True)) | (Violation.detected_at < protected_after)
                )
                .order_by(Violation.detected_at.asc())
                .limit(50)
                .all()
            )
            if not oldest:
                break
            deleted_quota += _delete_rows(session, oldest)
            usage_bytes = directory_size_bytes(settings.MEDIA_ROOT)

        orphans = cleanup_orphan_media()
        result = {
            "deleted_expired": deleted_expired,
            "deleted_by_quota": deleted_quota,
            "deleted_orphans": orphans,
            "usage_mb": round(directory_size_bytes(settings.MEDIA_ROOT) / 1024**2, 2),
            "free_quota_mb": round(max(0.0, quota_bytes - directory_size_bytes(settings.MEDIA_ROOT)) / 1024**2, 2),
            "keep_days": keep_days,
            "max_gb": quota_gb,
            "duration_sec": round(time.perf_counter() - started, 2),
            "ran_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        save_retention({"last_run_at": result["ran_at"], "last_result": result}, db=session)
        event_bus.publish("retention.cleanup", result)
        return result
    finally:
        if own:
            session.close()


class RetentionWorker(threading.Thread):
    """Фоновая автоочистка раз в RETENTION_INTERVAL_SEC, если включена политика."""

    def __init__(self) -> None:
        super().__init__(daemon=True, name="media-retention")
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self.run, daemon=True, name="media-retention")
        self._thread.start()

    def run(self) -> None:
        # Первый запуск не сразу: даём приложению подняться
        self._stop.wait(30)
        while not self._stop.is_set():
            try:
                policy = load_retention()
                if policy.get("auto_clean"):
                    run_cleanup(days=policy["days"], max_gb=policy["max_gb"])
            except Exception:
                logger.exception("Ошибка автоочистки медиа")
            self._stop.wait(max(60, settings.RETENTION_INTERVAL_SEC))

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)


retention_worker = RetentionWorker()
