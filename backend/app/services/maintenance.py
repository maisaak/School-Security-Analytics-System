"""Periodic bounded retention, including laboratory results not saved as incidents."""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.core.security import safe_delete_media_file
from app.db.models import Violation
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)


def cleanup_media() -> None:
    with SessionLocal() as db:
        rows = db.query(Violation).order_by(Violation.id.desc()).offset(settings.MAX_STORED_VIOLATIONS).all()
        paths = {p for row in rows for p in (row.image_path, row.video_path) if p}
        for row in rows:
            db.delete(row)
        db.flush()
        referenced = {p for row in db.query(Violation).all() for p in (row.image_path, row.video_path) if p}
        db.commit()
    for path in paths - referenced:
        safe_delete_media_file(path)
    cutoff = time.time() - settings.UPLOAD_RETENTION_HOURS * 3600
    for path in (settings.MEDIA_ROOT / "uploads").glob("analyzed_*"):
        url = "/media/" + path.relative_to(settings.MEDIA_ROOT).as_posix()
        if path.is_file() and path.stat().st_mtime < cutoff and url not in referenced:
            path.unlink(missing_ok=True)


def run_maintenance(stop: threading.Event) -> None:
    while not stop.wait(60):
        try:
            cleanup_media()
        except Exception:
            logger.exception("Ошибка очистки устаревших медиафайлов")
