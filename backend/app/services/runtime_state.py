from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import SystemFlag
from app.db.session import SessionLocal


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_flag(key: str, default: Any = None, db: Session | None = None) -> Any:
    own = db is None
    session = db or SessionLocal()
    try:
        row = session.query(SystemFlag).filter(SystemFlag.key == key).first()
        if row is None:
            return default
        try:
            return json.loads(row.value_json or "null")
        except (TypeError, ValueError):
            return default
    finally:
        if own:
            session.close()


def set_flag(key: str, value: Any, db: Session | None = None) -> Any:
    own = db is None
    session = db or SessionLocal()
    try:
        row = session.query(SystemFlag).filter(SystemFlag.key == key).first()
        payload = json.dumps(value, ensure_ascii=False, default=str)
        if row is None:
            row = SystemFlag(key=key, value_json=payload)
            session.add(row)
        else:
            row.value_json = payload
            row.updated_at = datetime.now(timezone.utc)
        session.commit()
        return value
    finally:
        if own:
            session.close()


# ── Политика хранения медиа ─────────────────────────────────────────────────

DEFAULT_RETENTION = {
    "days": settings.RETENTION_DAYS,
    "max_gb": settings.RETENTION_MAX_GB,
    "auto_clean": settings.RETENTION_AUTO_CLEAN,
    "last_run_at": None,
    "last_result": None,
}


def load_retention(db: Session | None = None) -> dict:
    stored = get_flag("retention", {}, db=db) or {}
    merged = {**DEFAULT_RETENTION, **{k: v for k, v in stored.items() if k in DEFAULT_RETENTION}}
    merged["days"] = max(1, min(int(merged.get("days") or 30), 3650))
    merged["max_gb"] = max(0.1, min(float(merged.get("max_gb") or 5.0), 2048.0))
    return merged


def save_retention(policy: dict, db: Session | None = None) -> dict:
    current = load_retention(db=db)
    current.update({k: v for k, v in policy.items() if k in DEFAULT_RETENTION and k not in {"last_run_at", "last_result"}})
    return set_flag("retention", current, db=db)


# ── Уведомления ─────────────────────────────────────────────────────────────

DEFAULT_NOTIFICATIONS = {
    "enabled": settings.TELEGRAM_ENABLED,
    "bot_token": settings.TELEGRAM_BOT_TOKEN,
    "director_chat_id": settings.TELEGRAM_DIRECTOR_CHAT_ID,
    "guard_chat_id": settings.TELEGRAM_GUARD_CHAT_ID,
    "notify_weapon": True,
    "notify_bag": True,
    "notify_dog": False,
    "notify_offline": True,
    "notify_emergency": True,
    "updated_at": None,
    "last_error": None,
    "last_sent_at": None,
}


def load_notifications(db: Session | None = None) -> dict:
    stored = get_flag("notifications", {}, db=db) or {}
    merged = {**DEFAULT_NOTIFICATIONS, **{k: v for k, v in stored.items() if k in DEFAULT_NOTIFICATIONS}}
    # Токен отдаём наружу только маскированным
    return merged


def public_notifications(db: Session | None = None) -> dict:
    data = load_notifications(db=db)
    token = str(data.get("bot_token") or "")
    data["bot_token_set"] = bool(token)
    data["bot_token"] = f"{token[:6]}…{token[-4:]}" if len(token) > 12 else ("" if not token else "••••")
    return data


def save_notifications(payload: dict, db: Session | None = None) -> dict:
    current = load_notifications(db=db)
    for key, value in payload.items():
        if key in {"bot_token_set", "updated_at", "last_error", "last_sent_at"}:
            continue
        if key in DEFAULT_NOTIFICATIONS and value is not None:
            current[key] = value
    current["updated_at"] = _now_iso()
    set_flag("notifications", current, db=db)
    return current


# ── Режим эвакуации ─────────────────────────────────────────────────────────

DEFAULT_EMERGENCY = {
    "active": False,
    "reason": "",
    "started_at": None,
    "started_by": None,
    "cleared_at": None,
    "cleared_by": None,
}


def load_emergency(db: Session | None = None) -> dict:
    stored = get_flag("emergency", {}, db=db) or {}
    return {**DEFAULT_EMERGENCY, **{k: v for k, v in stored.items() if k in DEFAULT_EMERGENCY}}


def set_emergency(active: bool, reason: str = "", actor: str | None = None, db: Session | None = None) -> dict:
    state = load_emergency(db=db)
    state["active"] = bool(active)
    if active:
        state.update(
            {
                "reason": reason.strip() or "Тревога: эвакуация",
                "started_at": _now_iso(),
                "started_by": actor,
                "cleared_at": None,
                "cleared_by": None,
            }
        )
    else:
        state.update({"cleared_at": _now_iso(), "cleared_by": actor, "reason": reason or state.get("reason", "")})
    return set_flag("emergency", state, db=db)
