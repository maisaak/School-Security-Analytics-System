from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.schemas import AuditPageOut, UserCreate, UserOut, UserUpdate
from app.api.serializers import serialize_audit, serialize_user
from app.core.auth import require_permissions
from app.core.permissions import Permission, Role, role_permissions
from app.core.security import hash_password, password_strength_error
from app.db.models import AuditLog, User
from app.db.session import get_db
from app.services.audit import record_audit

router = APIRouter(prefix="/api", tags=["Admin: пользователи и аудит"])


# ─── Управление пользователями ────────────────────────────────────────────────

@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.USERS_MANAGE)),
):
    users = db.query(User).order_by(User.id.asc()).all()
    return [serialize_user(u) for u in users]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permissions(Permission.USERS_MANAGE)),
):
    username = payload.username.strip()
    if db.query(User).filter(func.lower(User.username) == username.lower()).first():
        raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")
    strength_error = password_strength_error(payload.password)
    if strength_error:
        raise HTTPException(status_code=400, detail=strength_error)

    user = User(
        username=username,
        full_name=payload.full_name.strip() or username,
        role=payload.role,
        password_hash=hash_password(payload.password),
        is_active=True,
        is_demo=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    record_audit(
        db,
        action="user.create",
        request=request,
        user=admin,
        entity_type="user",
        entity_id=user.id,
        detail={"username": user.username, "role": user.role, "full_name": user.full_name},
    )
    return serialize_user(user)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permissions(Permission.USERS_MANAGE)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    changes: dict = {}
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
        changes["full_name"] = user.full_name
    if payload.role is not None and payload.role != user.role:
        if user.role == Role.ADMIN.value and payload.role != Role.ADMIN.value:
            admins = db.query(User).filter(User.role == Role.ADMIN.value, User.is_active.is_(True)).count()
            if admins <= 1:
                raise HTTPException(status_code=409, detail="Нельзя понизить роль последнего администратора")
        changes["role"] = {"from": user.role, "to": payload.role}
        user.role = payload.role
    if payload.is_active is not None and payload.is_active != user.is_active:
        if not payload.is_active:
            if user.id == admin.id:
                raise HTTPException(status_code=409, detail="Нельзя отключить собственную учётную запись")
            if user.role == Role.ADMIN.value:
                admins = db.query(User).filter(User.role == Role.ADMIN.value, User.is_active.is_(True)).count()
                if admins <= 1:
                    raise HTTPException(status_code=409, detail="Нельзя отключить последнего администратора")
        changes["is_active"] = payload.is_active
        user.is_active = payload.is_active
    if payload.password:
        strength_error = password_strength_error(payload.password)
        if strength_error:
            raise HTTPException(status_code=400, detail=strength_error)
        user.password_hash = hash_password(payload.password)
        changes["password"] = "changed"

    db.commit()
    db.refresh(user)
    record_audit(
        db,
        action="user.update",
        request=request,
        user=admin,
        entity_type="user",
        entity_id=user.id,
        detail={"username": user.username, "changes": changes},
    )
    return serialize_user(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_permissions(Permission.USERS_MANAGE)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if user.id == admin.id:
        raise HTTPException(status_code=409, detail="Нельзя удалить собственную учётную запись")
    if user.role == Role.ADMIN.value:
        admins = db.query(User).filter(User.role == Role.ADMIN.value, User.is_active.is_(True)).count()
        if admins <= 1:
            raise HTTPException(status_code=409, detail="Нельзя удалить последнего администратора")

    payload = {"username": user.username, "role": user.role, "full_name": user.full_name}
    db.delete(user)
    db.commit()
    record_audit(
        db,
        action="user.delete",
        request=request,
        user=admin,
        entity_type="user",
        entity_id=user_id,
        detail=payload,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/users/roles")
def list_roles(_: User = Depends(require_permissions(Permission.USERS_MANAGE))):
    return {
        role.value: {"label": role.value, "permissions": role_permissions(role)}
        for role in Role
    }


# ─── Полный журнал аудита ─────────────────────────────────────────────────────

@router.get("/audit", response_model=AuditPageOut)
def list_audit_log(
    action: str | None = None,
    actor: str | None = None,
    entity_type: str | None = None,
    outcome: str | None = None,
    search: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.AUDIT_VIEW)),
):
    query = db.query(AuditLog)
    if action:
        query = query.filter(AuditLog.action == action)
    if actor:
        query = query.filter(AuditLog.actor_username == actor)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if outcome:
        query = query.filter(AuditLog.outcome == outcome)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                AuditLog.detail.ilike(pattern),
                AuditLog.actor_username.ilike(pattern),
                AuditLog.action.ilike(pattern),
                AuditLog.entity_id.ilike(pattern),
            )
        )

    total = query.count()
    rows = query.order_by(AuditLog.id.desc()).offset(offset).limit(limit).all()
    actions = [row[0] for row in db.query(AuditLog.action).distinct().order_by(AuditLog.action.asc()).all()]
    return AuditPageOut(total=total, items=[serialize_audit(r) for r in rows], actions=actions)


@router.get("/audit/export")
def export_audit_log(
    request: Request,
    limit: int = Query(default=5000, ge=1, le=20000),
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.AUDIT_VIEW)),
):
    rows = db.query(AuditLog).order_by(AuditLog.id.desc()).limit(limit).all()
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(
        ["id", "created_at", "actor", "role", "action", "entity_type", "entity_id", "outcome", "ip", "detail"]
    )
    for row in rows:
        writer.writerow(
            [
                row.id,
                (row.created_at or datetime.now(timezone.utc)).isoformat(),
                row.actor_username,
                row.actor_role,
                row.action,
                row.entity_type,
                row.entity_id,
                row.outcome,
                row.ip_address,
                (row.detail or "").replace("\n", " "),
            ]
        )
    record_audit(
        db,
        action="audit.export",
        request=request,
        user=user,
        entity_type="audit_log",
        detail={"exported_rows": len(rows)},
    )
    return Response(
        content="\ufeff" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="school_security_audit.csv"'},
    )


@router.get("/audit/summary")
def audit_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.AUDIT_VIEW)),
):
    since = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    total = db.query(AuditLog).count()
    denied = db.query(AuditLog).filter(AuditLog.outcome == "denied").count()
    today = db.query(AuditLog).filter(AuditLog.created_at >= since).count()
    by_action = [
        {"action": action, "count": count}
        for action, count in db.query(AuditLog.action, func.count(AuditLog.id))
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc())
        .limit(12)
        .all()
    ]
    return {"total": total, "denied": denied, "today": today, "by_action": by_action}
