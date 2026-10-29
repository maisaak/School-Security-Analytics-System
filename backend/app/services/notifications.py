"""Best-effort incident notifications; delivery failures never affect detection."""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.parse
import urllib.request

from app.core.config import settings

logger = logging.getLogger(__name__)
_lock = threading.Lock()
_last_sent: dict[str, float] = {}


def _allowed(kind: str) -> bool:
    now = time.monotonic()
    with _lock:
        previous = _last_sent.get(kind, 0.0)
        if now - previous < settings.NOTIFICATION_COOLDOWN_SEC:
            return False
        _last_sent[kind] = now
        return True


def _send(url: str, data: bytes, content_type: str) -> None:
    request = urllib.request.Request(url, data=data, headers={"Content-Type": content_type}, method="POST")
    with urllib.request.urlopen(request, timeout=settings.NOTIFICATION_TIMEOUT_SEC) as response:
        response.read(256)


def _deliver(violation_type: str, camera_name: str, confidence: float) -> None:
    message = f"Школьный мониторинг: {violation_type} на камере «{camera_name}», уверенность {confidence:.0%}. Требуется проверка оператором."
    if settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_CHAT_ID:
        url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
        data = urllib.parse.urlencode({"chat_id": settings.TELEGRAM_CHAT_ID, "text": message}).encode()
        _send(url, data, "application/x-www-form-urlencoded")
    if settings.NOTIFICATION_WEBHOOK_URL:
        data = json.dumps({"event": "violation", "type": violation_type, "camera": camera_name, "confidence": confidence, "message": message}).encode()
        _send(settings.NOTIFICATION_WEBHOOK_URL, data, "application/json")


def notify_incident(violation_type: str, camera_name: str, confidence: float) -> None:
    if not ((settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_CHAT_ID) or settings.NOTIFICATION_WEBHOOK_URL):
        return
    if not _allowed(violation_type):
        return
    threading.Thread(target=_safe_deliver, args=(violation_type, camera_name, confidence), daemon=True).start()


def _safe_deliver(violation_type: str, camera_name: str, confidence: float) -> None:
    try:
        _deliver(violation_type, camera_name, confidence)
    except Exception:
        logger.exception("Не удалось отправить уведомление об инциденте")
