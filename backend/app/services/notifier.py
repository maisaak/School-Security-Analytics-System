from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any

import requests
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import User, Violation
from app.db.session import SessionLocal
from app.services.audit import record_audit
from app.services.event_bus import event_bus
from app.services.runtime_state import load_notifications, save_notifications

logger = logging.getLogger("school_security.notifier")

TELEGRAM_API = "https://api.telegram.org"

VIOLATION_LABELS = {
    "weapon": "🔴 Оружие",
    "suspicious_bag": "🟠 Бесхозная сумка",
    "dog": "🟡 Собака на территории",
}


def _to_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _format_violation(row: Violation) -> str:
    camera = row.camera
    detected = _to_utc(row.detected_at)
    return (
        f"<b>{VIOLATION_LABELS.get(row.violation_type, row.violation_type)}</b>\n"
        f"📍 {camera.name if camera else 'Камера'} · {camera.location if camera else ''}\n"
        f"🎯 Уверенность: {row.confidence * 100:.1f}%\n"
        f"🕒 {detected.astimezone().strftime('%d.%m.%Y %H:%M:%S') if detected else '—'}"
        + (f"\n🏷 Трек: {row.track_id}" if row.track_id else "")
        + (f"\n⏱ Выдержка: {row.dwell_seconds:.1f} с" if row.dwell_seconds is not None else "")
    )


class TelegramNotifier:
    """Оповещения охраны и директора в Telegram с кнопкой подтверждения инцидента."""

    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._offset = 0
        self.last_error: str | None = None
        self.last_sent_at: str | None = None
        self.sent_count = 0
        self._lock = threading.Lock()

    # ── отправка ────────────────────────────────────────────────────────────
    def _config(self) -> dict:
        db = SessionLocal()
        try:
            return load_notifications(db=db)
        finally:
            db.close()

    @staticmethod
    def _targets(config: dict, violation_type: str) -> list[str]:
        if not config.get("enabled") or not config.get("bot_token"):
            return []
        director = str(config.get("director_chat_id") or "").strip()
        guard = str(config.get("guard_chat_id") or "").strip()
        if violation_type == "weapon":
            if not config.get("notify_weapon", True):
                return []
            return [chat for chat in dict.fromkeys([director, guard]) if chat]
        if violation_type == "suspicious_bag":
            if not config.get("notify_bag", True):
                return []
            return [chat for chat in dict.fromkeys([guard, director]) if chat]
        if violation_type == "dog":
            if not config.get("notify_dog", False):
                return []
            return [chat for chat in dict.fromkeys([guard]) if chat]
        return []

    def _post(self, method: str, payload: dict, files: dict | None = None) -> dict:
        config = self._config()
        token = str(config.get("bot_token") or "")
        if not token:
            raise RuntimeError("Не задан токен Telegram-бота")
        url = f"{TELEGRAM_API}/bot{token}/{method}"
        response = requests.post(url, data=payload, files=files, timeout=8)
        data = response.json()
        if not data.get("ok"):
            raise RuntimeError(str(data.get("description") or f"HTTP {response.status_code}"))
        return data

    def send_message(self, chat_id: str, text: str, keyboard: dict | None = None) -> bool:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        if keyboard:
            payload["reply_markup"] = json.dumps(keyboard, ensure_ascii=False)
        try:
            self._post("sendMessage", payload)
            with self._lock:
                self.last_sent_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
                self.sent_count += 1
                self.last_error = None
            return True
        except Exception as exc:  # сеть/токен недоступны — не роняем видеоконвейер
            with self._lock:
                self.last_error = str(exc)[:300]
            logger.warning("Telegram: не удалось отправить сообщение: %s", exc)
            return False

    def notify_violation(self, violation_id: int, violation_type: str, text: str, snapshot_path: str | None) -> None:
        config = self._config()
        targets = self._targets(config, violation_type)
        if not targets:
            return
        keyboard = {
            "inline_keyboard": [
                [{"text": "✅ Подтвердить отработку", "callback_data": f"ack:{violation_id}"}],
            ]
        }
        for chat_id in targets:
            self.send_message(chat_id, text, keyboard)

    def notify_text(self, text: str, *, only_director: bool = False) -> None:
        config = self._config()
        if not config.get("enabled") or not config.get("bot_token"):
            return
        chats = [str(config.get("director_chat_id") or "").strip()]
        if not only_director:
            chats.append(str(config.get("guard_chat_id") or "").strip())
        for chat_id in dict.fromkeys(chat for chat in chats if chat):
            self.send_message(chat_id, text)

    # ── подтверждение из бота ───────────────────────────────────────────────
    def _ack_from_telegram(self, violation_id: int, actor: str, callback_id: str) -> tuple[bool, str]:
        db = SessionLocal()
        try:
            row = db.query(Violation).filter(Violation.id == violation_id).first()
            if row is None:
                self._answer_callback(callback_id, "Инцидент уже удалён")
                return False, "Инцидент не найден"
            if row.is_acknowledged:
                self._answer_callback(callback_id, "Уже подтверждено")
                return False, "Уже подтверждено"
            now = datetime.now(timezone.utc)
            detected = _to_utc(row.detected_at) or now
            row.is_acknowledged = True
            row.acknowledged_by = f"telegram:{actor}"
            row.acknowledged_at = now
            row.acknowledged_latency_sec = max(0.0, (now - detected).total_seconds())
            db.commit()
            record_audit(
                db,
                action="violation.ack",
                actor_username=f"telegram:{actor}",
                actor_role="telegram",
                entity_type="violation",
                entity_id=row.id,
                detail={"source": "telegram", "violation_type": row.violation_type, "camera_id": row.camera_id},
            )
            event_bus.publish(
                "violation.acknowledged",
                {
                    "id": row.id,
                    "acknowledged_by": row.acknowledged_by,
                    "latency_sec": round(row.acknowledged_latency_sec, 1),
                    "source": "telegram",
                },
            )
            self._answer_callback(callback_id, "Отработка подтверждена ✅")
            return True, "ok"
        finally:
            db.close()

    def _answer_callback(self, callback_id: str, text: str) -> None:
        try:
            self._post("answerCallbackQuery", {"callback_query_id": callback_id, "text": text})
        except Exception:
            pass

    def _poll(self) -> None:
        while not self._stop.is_set():
            config = self._config()
            token = str(config.get("bot_token") or "")
            if not (config.get("enabled") and token):
                self._stop.wait(5)
                continue
            try:
                response = requests.get(
                    f"{TELEGRAM_API}/bot{token}/getUpdates",
                    params={"offset": self._offset, "timeout": 0, "allowed_updates": '["callback_query","message"]'},
                    timeout=10,
                )
                data = response.json()
                for update in data.get("result", []):
                    self._offset = max(self._offset, int(update.get("update_id", 0)) + 1)
                    callback = update.get("callback_query")
                    if not callback:
                        continue
                    payload = str(callback.get("data") or "")
                    actor = str((callback.get("from") or {}).get("username") or (callback.get("from") or {}).get("id") or "bot")
                    if payload.startswith("ack:"):
                        try:
                            violation_id = int(payload.split(":", 1)[1])
                        except ValueError:
                            continue
                        self._ack_from_telegram(violation_id, actor, str(callback.get("id") or ""))
                with self._lock:
                    self.last_error = None
            except Exception as exc:
                with self._lock:
                    self.last_error = str(exc)[:300]
                self._stop.wait(10)
                continue
            self._stop.wait(max(1.0, settings.TELEGRAM_POLL_SEC))

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._poll, name="telegram-notifier", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)


notifier = TelegramNotifier()


def _send_async(text: str, chat_ids: list[str], keyboard: dict | None = None) -> None:
    def worker() -> None:
        for chat_id in chat_ids:
            notifier.send_message(chat_id, text, keyboard)

    threading.Thread(target=worker, daemon=True).start()


def notify_violation(violation_id: int, row: Violation | None = None) -> None:
    """Вызывается из потока камеры: сообщение в Telegram + событие в SSE-ленту."""
    db = SessionLocal()
    try:
        row = row or db.query(Violation).filter(Violation.id == violation_id).first()
        if row is None:
            return
        text = _format_violation(row)
        config = load_notifications(db=db)
        targets = TelegramNotifier._targets(config, row.violation_type)
        if targets:
            _send_async(
                text,
                targets,
                {"inline_keyboard": [[{"text": "✅ Подтвердить отработку", "callback_data": f"ack:{row.id}"}]]},
            )
        event_bus.publish(
            "violation.created",
            {
                "id": row.id,
                "camera_id": row.camera_id,
                "camera_name": row.camera.name if row.camera else f"Камера #{row.camera_id}",
                "camera_location": row.camera.location if row.camera else "",
                "violation_type": row.violation_type,
                "confidence": round(row.confidence, 4),
                "track_id": row.track_id,
                "dwell_seconds": row.dwell_seconds,
                "zone_name": row.zone_name,
                "detected_at": (row.detected_at or datetime.now(timezone.utc)).isoformat(),
                "image_path": row.image_path,
            },
        )
        # Сохраняем статус отправки для диагностики в панели безопасности
        if targets:
            save_notifications({"last_error": notifier.last_error}, db=db)
    finally:
        db.close()


def notify_camera_offline(camera_name: str, location: str, online: bool) -> None:
    if online:
        return
    config = load_notifications()
    if not config.get("notify_offline", True):
        return
    text = (
        f"⚠️ <b>Камера недоступна</b>\n"
        f"📍 {camera_name} · {location}\n"
        f"Watchdog перезапускает поток автоматически."
    )
    chats = [
        str(config.get("guard_chat_id") or "").strip(),
        str(config.get("director_chat_id") or "").strip(),
    ]
    _send_async(text, list(dict.fromkeys(chat for chat in chats if chat)))
    event_bus.publish("camera.offline", {"camera_name": camera_name, "location": location})


def notify_emergency(active: bool, reason: str, actor: str) -> None:
    emoji = "🚨" if active else "✅"
    title = "ЭВАКУАЦИЯ: режим тревоги включён" if active else "Тревога отменена"
    text = f"{emoji} <b>{title}</b>\nПричина: {reason or '—'}\nИнициатор: {actor}"
    config = load_notifications()
    if not config.get("enabled") or not config.get("notify_emergency", True):
        return
    chats = [
        str(config.get("director_chat_id") or "").strip(),
        str(config.get("guard_chat_id") or "").strip(),
    ]
    _send_async(text, list(dict.fromkeys(chat for chat in chats if chat)))


def ack_violation_row(db: Session, row: Violation, username: str) -> Violation:
    """Единая логика подтверждения: отметка, SLA-задержка и событие в SSE."""
    now = datetime.now(timezone.utc)
    detected = _to_utc(row.detected_at) or now
    row.is_acknowledged = True
    row.acknowledged_by = username
    row.acknowledged_at = now
    row.acknowledged_latency_sec = max(0.0, (now - detected).total_seconds())
    db.commit()
    db.refresh(row)
    event_bus.publish(
        "violation.acknowledged",
        {
            "id": row.id,
            "acknowledged_by": username,
            "latency_sec": round(row.acknowledged_latency_sec, 1),
            "is_acknowledged": True,
        },
    )
    return row
