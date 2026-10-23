from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.schemas import CameraScopeIn
from app.api.serializers import serialize_user
from app.core.auth import require_permissions
from app.core.config import settings
from app.core.permissions import Permission
from app.db.models import AuditLog, Camera, User
from app.db.session import get_db
from app.services.audit import record_audit

router = APIRouter(prefix="/api/security", tags=["Безопасность учётных записей"])


@router.get("/overview")
def security_overview(
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.SECURITY_MANAGE)),
):
    users = db.query(User).all()
    cameras = db.query(Camera).all()
    now = datetime.now(timezone.utc)
    locked = [
        {
            "username": user.username,
            "locked_until": (user.locked_until if user.locked_until and user.locked_until.tzinfo else (user.locked_until.replace(tzinfo=timezone.utc) if user.locked_until else None)),
        }
        for user in users
        if user.locked_until and (user.locked_until if user.locked_until.tzinfo else user.locked_until.replace(tzinfo=timezone.utc)) > now
    ]
    failed_events = (
        db.query(AuditLog)
        .filter(AuditLog.action.in_(["auth.login_failed", "auth.2fa_failed", "auth.account_locked"]))
        .order_by(AuditLog.id.desc())
        .limit(200)
        .all()
    )
    exports = (
        db.query(AuditLog)
        .filter(AuditLog.action.in_(["violation.snapshot_download", "violation.video_download", "report.download", "violations.export"]))
        .order_by(AuditLog.id.desc())
        .limit(20)
        .all()
    )
    return {
        "users_total": len(users),
        "users_with_2fa": sum(1 for user in users if user.totp_enabled),
        "users_restricted": sum(1 for user in users if (user.camera_scope_json or "[]") not in {"[]", ""}),
        "cameras_total": len(cameras),
        "locked_accounts": locked,
        "password_policy": {
            "min_length": settings.PASSWORD_MIN_LENGTH,
            "requires_upper": True,
            "requires_lower": True,
            "requires_digit": True,
            "lockout_attempts": settings.LOGIN_LOCKOUT_ATTEMPTS,
            "lockout_minutes": settings.LOGIN_LOCKOUT_MINUTES,
            "rate_limit_attempts": settings.LOGIN_RATE_LIMIT_ATTEMPTS,
            "rate_limit_window_sec": settings.LOGIN_RATE_LIMIT_WINDOW_SEC,
        },
        "recent_failures": [
            {
                "created_at": entry.created_at,
                "actor": entry.actor_username,
                "action": entry.action,
                "ip": entry.ip_address,
            }
            for entry in failed_events[:10]
        ],
        "recent_exports": [
            {
                "created_at": entry.created_at,
                "actor": entry.actor_username,
                "action": entry.action,
                "detail": entry.detail,
            }
            for entry in exports
        ],
    }


@router.get("/users/{user_id}/camera-scope")
def get_camera_scope(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.SECURITY_MANAGE)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    try:
        scope = json.loads(user.camera_scope_json or "[]")
    except (TypeError, ValueError):
        scope = []
    return {"user_id": user.id, "camera_ids": scope if isinstance(scope, list) else [], "user": serialize_user(user)}


@router.put("/users/{user_id}/camera-scope")
def set_camera_scope(
    user_id: int,
    payload: CameraScopeIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.SECURITY_MANAGE)),
):
    """Ограничение доступа к камерам: пустой список означает «все камеры»."""
    target = db.query(User).filter(User.id == user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    valid_ids = {cam.id for cam in db.query(Camera).all()}
    scope = sorted({int(value) for value in payload.camera_ids if int(value) in valid_ids})
    target.camera_scope_json = json.dumps(scope)
    db.commit()
    db.refresh(target)
    record_audit(
        db,
        action="security.camera_scope.update",
        request=request,
        user=user,
        entity_type="user",
        entity_id=target.id,
        detail={"username": target.username, "camera_ids": scope},
    )
    return {"user_id": target.id, "camera_ids": scope, "user": serialize_user(target)}


@router.post("/users/{user_id}/2fa/reset")
def reset_user_two_factor(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.SECURITY_MANAGE)),
):
    target = db.query(User).filter(User.id == user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if target.id == user.id:
        raise HTTPException(status_code=400, detail="Отключите 2FA в своём профиле, а не через сброс администратором")
    target.totp_enabled = False
    target.totp_secret = None
    target.totp_recovery_json = "[]"
    target.failed_login_count = 0
    target.locked_until = None
    db.commit()
    record_audit(
        db,
        action="security.2fa.reset",
        request=request,
        user=user,
        entity_type="user",
        entity_id=target.id,
        detail={"username": target.username},
    )
    return {"status": "reset", "user": serialize_user(target)}


@router.post("/users/{user_id}/unlock")
def unlock_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.SECURITY_MANAGE)),
):
    target = db.query(User).filter(User.id == user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    target.failed_login_count = 0
    target.locked_until = None
    db.commit()
    record_audit(
        db,
        action="security.user.unlock",
        request=request,
        user=user,
        entity_type="user",
        entity_id=target.id,
        detail={"username": target.username},
    )
    return {"status": "unlocked", "user": serialize_user(target)}
