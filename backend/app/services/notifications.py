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
_last_sent: dict[tuple[str, str], float] = {}
_delivery_slots = threading.BoundedSemaphore(4)


def _allowed(kind: str, camera_name: str = "") -> bool:
    now = time.monotonic()
    key = (kind, camera_name)
    with _lock:
        previous = _last_sent.get(key)
        if previous is not None and now - previous < settings.NOTIFICATION_COOLDOWN_SEC:
            return False
        if len(_last_sent) >= 4096:
            expired = [key for key, sent in _last_sent.items() if now - sent >= settings.NOTIFICATION_COOLDOWN_SEC]
            for expired_key in expired:
                del _last_sent[expired_key]
            if len(_last_sent) >= 4096:
                return False
        _last_sent[key] = now
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
        _send_channel("telegram", url, data, "application/x-www-form-urlencoded")
    if settings.NOTIFICATION_WEBHOOK_URL:
        data = json.dumps({"event": "violation", "type": violation_type, "camera": camera_name, "confidence": confidence, "message": message}).encode()
        _send_channel("webhook", settings.NOTIFICATION_WEBHOOK_URL, data, "application/json")


def _send_channel(channel: str, url: str, data: bytes, content_type: str) -> None:
    try:
        _send(url, data, content_type)
    except Exception:
        # HTTP errors can embed the bot token or webhook URL. Never log exceptions here.
        logger.warning("Не удалось отправить уведомление через %s", channel)


def notify_incident(violation_type: str, camera_name: str, confidence: float) -> None:
    if not ((settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_CHAT_ID) or settings.NOTIFICATION_WEBHOOK_URL):
        return
    if not _delivery_slots.acquire(blocking=False):
        return
    if not _allowed(violation_type, camera_name):
        _delivery_slots.release()
        return
    def deliver():
        try:
            _safe_deliver(violation_type, camera_name, confidence)
        finally:
            _delivery_slots.release()
    try:
        threading.Thread(target=deliver, args=(), daemon=True).start()
    except Exception:
        _delivery_slots.release()
        logger.warning("Не удалось запустить отправку уведомления")


def _safe_deliver(violation_type: str, camera_name: str, confidence: float) -> None:
    try:
        _deliver(violation_type, camera_name, confidence)
    except Exception:
        logger.warning("Не удалось подготовить уведомление об инциденте")
