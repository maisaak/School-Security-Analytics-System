from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.security import redact_secrets, redact_text
from app.db.models import AuditLog, User

logger = logging.getLogger("school_security.audit")


def client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()[:64]
    return (request.client.host if request.client else None)


def record_audit(
    db: Session,
    *,
    action: str,
    request: Request | None = None,
    user: User | None = None,
    actor_username: str | None = None,
    actor_role: str | None = None,
    actor_id: int | None = None,
    entity_type: str | None = None,
    entity_id: int | str | None = None,
    outcome: str = "success",
    detail: dict[str, Any] | str | None = None,
) -> AuditLog:
    """Пишет запись в полный журнал аудита. Пароли и rtsp-креды вычищаются автоматически."""
    if isinstance(detail, dict):
        payload = json.dumps(redact_secrets(detail), ensure_ascii=False, default=str)
    elif isinstance(detail, str):
        payload = redact_text(detail)
    else:
        payload = ""

    entry = AuditLog(
        actor_id=actor_id if actor_id is not None else (user.id if user else None),
        actor_username=actor_username or (user.username if user else "anonymous"),
        actor_role=actor_role or (user.role if user else None),
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        outcome=outcome,
        ip_address=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:256] if request else None,
        detail=payload[:4000],
    )
    try:
        db.add(entry)
        db.commit()
    except Exception:  # аудит не должен ронять основной запрос
        db.rollback()
        logger.exception("Не удалось записать событие аудита %s", action)
    return entry
