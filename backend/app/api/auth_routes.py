from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.api.schemas import (
    AuthSessionOut,
    DemoAccountOut,
    DemoLoginRequest,
    LoginRequest,
    UserOut,
)
from app.api.serializers import serialize_user
from app.core.auth import (
    clear_auth_cookie,
    get_current_user,
    set_auth_cookie,
    user_payload,
)
from app.core.config import settings
from app.core.permissions import ROLE_DESCRIPTIONS, ROLE_LABELS, Role
from app.core.security import create_access_token, verify_password
from app.db.models import User
from app.db.session import get_db
from app.services.audit import client_ip, record_audit

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

# Простое in-memory окно попыток входа (защита от brute-force без внешних зависимостей)
_ATTEMPTS: dict[str, deque[float]] = defaultdict(deque)
_ATTEMPTS_LOCK = threading.Lock()


def _rate_limit_key(username: str, request: Request) -> str:
    return f"{client_ip(request) or 'unknown'}:{username.lower()}"


def _check_rate_limit(key: str) -> None:
    now = time.monotonic()
    window = settings.LOGIN_RATE_LIMIT_WINDOW_SEC
    with _ATTEMPTS_LOCK:
        bucket = _ATTEMPTS[key]
        while bucket and now - bucket[0] > window:
            bucket.popleft()
        if len(bucket) >= settings.LOGIN_RATE_LIMIT_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Слишком много попыток входа. Повторите через несколько минут.",
            )


def _register_failure(key: str) -> None:
    with _ATTEMPTS_LOCK:
        _ATTEMPTS[key].append(time.monotonic())


def _issue_session(response: Response, db: Session, user: User) -> AuthSessionOut:
    token, expires_at = create_access_token(
        str(user.id),
        username=user.username,
        role=user.role,
    )
    max_age = int((expires_at - datetime.now(timezone.utc)).total_seconds())
    set_auth_cookie(response, token, max_age_seconds=max_age)

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return AuthSessionOut(user=serialize_user(user), expires_at=expires_at)


@router.post("/login", response_model=AuthSessionOut)
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    username = payload.username.strip()
    key = _rate_limit_key(username, request)
    _check_rate_limit(key)

    user = db.query(User).filter(User.username == username).first()
    if user is None or not verify_password(payload.password, user.password_hash or ""):
        _register_failure(key)
        record_audit(
            db,
            action="auth.login_failed",
            request=request,
            actor_username=username,
            entity_type="user",
            entity_id=username,
            outcome="denied",
            detail={"reason": "invalid_credentials"},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль",
        )
    if not user.is_active:
        record_audit(
            db,
            action="auth.login_blocked",
            request=request,
            actor_username=username,
            actor_role=user.role,
            entity_type="user",
            entity_id=user.id,
            outcome="denied",
            detail={"reason": "account_disabled"},
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Учётная запись отключена администратором",
        )

    session = _issue_session(response, db, user)
    record_audit(
        db,
        action="auth.login",
        request=request,
        user=user,
        entity_type="user",
        entity_id=user.id,
        detail={"method": "password", "role": user.role},
    )
    return session


@router.post("/demo-login", response_model=AuthSessionOut)
def demo_login(payload: DemoLoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    """Быстрый вход с карточек ролей на странице логина (только для предустановленных демо-аккаунтов)."""
    if not settings.DEMO_LOGIN_ENABLED:
        raise HTTPException(status_code=403, detail="Быстрый демо-вход отключён администратором")

    user = db.query(User).filter(User.username == payload.username.strip()).first()
    if user is None or not user.is_demo or not user.is_active:
        raise HTTPException(status_code=404, detail="Демо-аккаунт не найден или отключён")

    session = _issue_session(response, db, user)
    record_audit(
        db,
        action="auth.demo_login",
        request=request,
        user=user,
        entity_type="user",
        entity_id=user.id,
        detail={"method": "quick_role_login", "role": user.role},
    )
    return session


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    user = None
    try:
        user = get_current_user(request, db)
    except HTTPException:
        user = None
    clear_auth_cookie(response)
    if user is not None:
        record_audit(
            db,
            action="auth.logout",
            request=request,
            user=user,
            entity_type="user",
            entity_id=user.id,
        )
    return {"status": "logged_out"}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return serialize_user(user)


@router.get("/permissions")
def permissions(user: User = Depends(get_current_user)):
    payload = user_payload(user)
    return {
        "user": {
            "id": payload["id"],
            "username": payload["username"],
            "role": payload["role"],
            "full_name": payload["full_name"],
        },
        "permissions": payload["permissions"],
        "roles": {role.value: {"label": ROLE_LABELS[role.value], "description": ROLE_DESCRIPTIONS[role.value]} for role in Role},
    }


@router.get("/demo-accounts", response_model=list[DemoAccountOut])
def demo_accounts(db: Session = Depends(get_db)):
    """Публичный список демо-аккаунтов для карточек быстрого входа на странице логина."""
    if not settings.DEMO_LOGIN_ENABLED:
        return []
    users = (
        db.query(User)
        .filter(User.is_demo.is_(True), User.is_active.is_(True))
        .order_by(User.id.asc())
        .all()
    )
    demo_passwords = {
        "admin": settings.DEMO_ADMIN_PASSWORD,
        "director": settings.DEMO_DIRECTOR_PASSWORD,
        "guard": settings.DEMO_GUARD_PASSWORD,
    }
    return [
        DemoAccountOut(
            username=u.username,
            role=u.role,
            role_label=ROLE_LABELS.get(u.role, u.role),
            full_name=u.full_name or ROLE_LABELS.get(u.role, u.role),
            description=ROLE_DESCRIPTIONS.get(u.role, ""),
            password_hint=demo_passwords.get(u.role, "••••••"),
        )
        for u in users
    ]
