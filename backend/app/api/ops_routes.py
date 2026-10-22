from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.schemas import BackupRestoreIn, EmergencyIn, NotificationSettingsIn, RetentionPolicyIn
from app.services.backups import create_backup as create_backup_file
from app.services.backups import database_path
from app.services.backups import list_backups as list_backup_files
from app.services.backups import restore_backup as restore_backup_file
from app.core.auth import require_permissions
from app.core.config import settings
from app.core.permissions import Permission
from app.db.models import Camera, User, Violation
from app.db.session import get_db
from app.services.audit import record_audit
from app.services.event_bus import event_bus
from app.services.metrics import metrics_available, metrics_response
from app.services.notifier import notifier, notify_emergency
from app.services.retention import directory_size_bytes, run_cleanup
from app.services.runtime_state import (
    load_emergency,
    load_notifications,
    load_retention,
    public_notifications,
    save_notifications,
    save_retention,
    set_emergency,
)
from app.services.stream_manager import stream_manager
from app.services.watchdog import watchdog

router = APIRouter(prefix="/api/ops", tags=["Эксплуатация"])


# ─── Уведомления ────────────────────────────────────────────────────────────

@router.get("/notifications")
def get_notifications(
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.OPS_MANAGE)),
):
    data = public_notifications(db=db)
    data["status"] = {
        "sent_count": notifier.sent_count,
        "last_sent_at": notifier.last_sent_at,
        "last_error": notifier.last_error,
        "polling": bool(notifier._thread and notifier._thread.is_alive()),  # noqa: SLF001
    }
    return data


@router.put("/notifications")
def update_notifications(
    payload: NotificationSettingsIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.OPS_MANAGE)),
):
    data = payload.model_dump(exclude_unset=True)
    if data.get("bot_token") in {"", "••••"} or (data.get("bot_token") or "").startswith("sk-"):
        data.pop("bot_token", None)
    updated = save_notifications(data, db=db)
    record_audit(
        db,
        action="ops.notifications.update",
        request=request,
        user=user,
        entity_type="settings",
        entity_id="notifications",
        detail={
            "enabled": updated.get("enabled"),
            "director_chat": bool(updated.get("director_chat_id")),
            "guard_chat": bool(updated.get("guard_chat_id")),
            "notify_weapon": updated.get("notify_weapon"),
            "notify_bag": updated.get("notify_bag"),
        },
    )
    return public_notifications(db=db)


@router.post("/notifications/test")
def test_notifications(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.OPS_MANAGE)),
):
    config = load_notifications(db=db)
    chats = [
        str(config.get("director_chat_id") or "").strip(),
        str(config.get("guard_chat_id") or "").strip(),
    ]
    chats = [chat for chat in dict.fromkeys(chats) if chat]
    if not config.get("bot_token") or not chats:
        raise HTTPException(status_code=400, detail="Заполните токен бота и chat_id получателей")
    results = []
    text = (
        "🔔 <b>Проверка связи</b>\n"
        f"Лицей №6 «Перспектива» · {datetime.now().strftime('%d.%m.%Y %H:%M')}\n"
        f"Инициатор: {user.username}"
    )
    for chat_id in chats:
        ok = notifier.send_message(chat_id, text)
        results.append({"chat_id": chat_id, "sent": ok})
    record_audit(
        db,
        action="ops.notifications.test",
        request=request,
        user=user,
        entity_type="settings",
        entity_id="notifications",
        detail={"results": results, "error": notifier.last_error},
    )
    return {
        "results": results,
        "error": notifier.last_error,
        "sent": any(item["sent"] for item in results),
    }


# ─── Политика хранения ──────────────────────────────────────────────────────

@router.get("/retention")
def get_retention(
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.OPS_MANAGE)),
):
    policy = load_retention(db=db)
    policy["usage_mb"] = round(directory_size_bytes(settings.MEDIA_ROOT) / 1024**2, 2)
    policy["quota_mb"] = round(float(policy["max_gb"]) * 1024, 1)
    policy["violations"] = db.query(Violation).count()
    return policy


@router.put("/retention")
def update_retention(
    payload: RetentionPolicyIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.OPS_MANAGE)),
):
    data = payload.model_dump(exclude_unset=True)
    save_retention(data, db=db)
    record_audit(
        db,
        action="ops.retention.update",
        request=request,
        user=user,
        entity_type="settings",
        entity_id="retention",
        detail=data,
    )
    return get_retention(db, user)


@router.post("/retention/cleanup")
def cleanup_media(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.OPS_MANAGE)),
):
    result = run_cleanup(db=db)
    record_audit(
        db,
        action="ops.retention.cleanup",
        request=request,
        user=user,
        entity_type="media",
        detail=result,
    )
    return result


# ─── Резервные копии ────────────────────────────────────────────────────────

@router.get("/backups")
def list_backups(_: User = Depends(require_permissions(Permission.OPS_MANAGE))):
    return list_backup_files()


@router.post("/backups")
def create_backup(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.OPS_MANAGE)),
):
    """Создаёт консистентную копию БД: sqlite backup API либо pg_dump для PostgreSQL."""
    try:
        data = create_backup_file()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Не удалось создать резервную копию: {exc}") from exc
    record_audit(
        db,
        action="ops.backup.create",
        request=request,
        user=user,
        entity_type="backup",
        entity_id=data["filename"],
        detail=data,
    )
    return data


@router.post("/backups/restore")
def restore_backup(
    payload: BackupRestoreIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.OPS_MANAGE)),
):
    """
    Восстановление SQLite-базы из резервной копии. Требует явного подтверждения
    словом ВОССТАНОВИТЬ — операция перезаписывает текущие данные.
    """
    if payload.confirm.strip().upper() not in {"ВОССТАНОВИТЬ", "RESTORE"}:
        raise HTTPException(status_code=400, detail="Введите слово ВОССТАНОВИТЬ для подтверждения операции")
    try:
        result = restore_backup_file(payload.filename)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Резервная копия не найдена") from exc
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc

    record_audit(
        db,
        action="ops.backup.restore",
        request=request,
        user=user,
        entity_type="backup",
        entity_id=result["source"],
        detail=result,
    )
    result["note"] = "Соединения БД пересозданы; при расхождениях перезапустите backend."
    return result


# ─── Watchdog и состояние ───────────────────────────────────────────────────

@router.get("/watchdog")
def watchdog_status(_: User = Depends(require_permissions(Permission.OPS_MANAGE))):
    return watchdog.status()


@router.get("/overview")
def ops_overview(
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.OPS_MANAGE)),
):
    backups = list(settings.BACKUP_DIR.glob("school_security_*"))
    db_path = database_path()
    return {
        "version": settings.APP_VERSION,
        "database": {
            "engine": "sqlite" if db_path else "postgresql",
            "size_mb": round((db_path.stat().st_size / 1024**2), 2) if db_path and db_path.exists() else None,
            "violations": db.query(Violation).count(),
            "cameras": db.query(Camera).count(),
        },
        "media": {
            "usage_mb": round(directory_size_bytes(settings.MEDIA_ROOT) / 1024**2, 2),
            "quota_mb": round(float(load_retention(db=db)["max_gb"]) * 1024, 1),
            "root": str(settings.MEDIA_ROOT),
        },
        "retention": load_retention(db=db),
        "backups": {
            "count": len(backups),
            "dir": str(settings.BACKUP_DIR),
            "latest": max((p.stat().st_mtime for p in backups), default=None),
        },
        "events": {
            "subscribers": event_bus.subscriber_count,
            "published": event_bus.total_published,
        },
        "metrics": {"enabled": metrics_available(), "path": "/metrics"},
        "watchdog": {"enabled": settings.WATCHDOG_ENABLED, "last_run": watchdog.last_run},
        "workers": stream_manager.status_snapshot(),
    }


@router.get("/metrics")
def prometheus_metrics(_: User = Depends(require_permissions(Permission.OPS_MANAGE))):
    """Метрики Prometheus только для администратора (публичный /metrics — в main)."""
    return metrics_response()


# ─── Режим эвакуации ────────────────────────────────────────────────────────

@router.get("/emergency")
def get_emergency(
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.CAMERAS_VIEW)),
):
    return load_emergency(db=db)


@router.post("/emergency")
def set_emergency_mode(
    payload: EmergencyIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.EMERGENCY_TRIGGER)),
):
    """
    Режим эвакуации: все камеры остаются на видеостене, охрана и директор
    получают сигнал, событие уходит во все открытые SSE-клиенты.
    """
    previous = load_emergency(db=db)
    if bool(previous.get("active")) == bool(payload.active):
        return previous
    state = set_emergency(payload.active, payload.reason, user.username, db=db)
    event_bus.publish("emergency", state)
    notify_emergency(payload.active, payload.reason, user.username)
    record_audit(
        db,
        action="ops.emergency.activate" if payload.active else "ops.emergency.clear",
        request=request,
        user=user,
        entity_type="system",
        entity_id="emergency",
        detail={"reason": payload.reason, "state": state},
    )
    return state
