from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.schemas import KPI_KEYS, PreferencesIn, PreferencesOut
from app.core.auth import require_permissions
from app.db.models import User
from app.db.session import get_db
from app.services.audit import record_audit

router = APIRouter(prefix="/api/settings", tags=["Настройки интерфейса"])


def default_preferences() -> dict:
    return PreferencesIn().model_dump()


def load_preferences(user: User) -> dict:
    """Настройки пользователя поверх дефолтов: старые записи не ломают новый формат."""
    base = default_preferences()
    try:
        stored = json.loads(user.preferences_json or "{}")
    except (TypeError, ValueError):
        stored = {}
    if not isinstance(stored, dict):
        stored = {}

    merged = {**base, **{k: v for k, v in stored.items() if k in base}}
    # Список KPI валидируем отдельно: старые записи могут содержать неизвестные ключи
    kpis = [k for k in merged.get("kpis") or [] if k in KPI_KEYS]
    merged["kpis"] = list(dict.fromkeys(kpis)) or base["kpis"]
    return merged


@router.get("/preferences", response_model=PreferencesOut)
def get_preferences(user: User = Depends(require_permissions("cameras:view"))):
    """Персональные настройки интерфейса текущего пользователя."""
    return PreferencesOut(**load_preferences(user))


@router.patch("/preferences", response_model=PreferencesOut)
def update_preferences(
    payload: PreferencesIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions("cameras:view")),
):
    """
    Сохраняет оформление и набор KPI.

    Настройки привязаны к пользователю и переезжают между устройствами:
    охрана может держать контрастную тему, а директор — светлую.
    """
    data = payload.model_dump()
    db_user = db.query(User).filter(User.id == user.id).first()
    if db_user is None:
        return PreferencesOut(**data)

    db_user.preferences_json = json.dumps(data, ensure_ascii=False)
    db.commit()

    record_audit(
        db,
        action="settings.preferences.update",
        request=request,
        user=user,
        entity_type="user",
        entity_id=user.id,
        detail={
            "theme": data["theme"],
            "accent": data["accent"],
            "kpis": data["kpis"],
            "compact_tables": data["compact_tables"],
        },
    )

    return PreferencesOut(**data, updated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
