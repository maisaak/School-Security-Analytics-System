from __future__ import annotations

import json
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.api.schemas import (
    AuthSessionOut,
    DemoAccountOut,
    DemoLoginRequest,
    LoginRequest,
    PasswordChangeIn,
    PasswordOnlyIn,
    TotpCodeIn,
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
from app.core.security import (
    create_access_token,
    hash_password,
    password_strength_error,
    verify_password,
)
from app.db.models import User
from app.db.session import get_db
from app.services.audit import client_ip, record_audit
from app.services.totp import (
    generate_recovery_codes,
    generate_secret,
    hash_recovery_code,
    provisioning_uri,
    verify_recovery_code,
    verify_totp,
)

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
    return AuthSessionOut(
        user=serialize_user(user),
        expires_at=expires_at,
        access_token=token if settings.AUTH_RETURN_TOKEN_IN_BODY else None,
    )


@router.post("/login", response_model=AuthSessionOut)
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    username = payload.username.strip()
    key = _rate_limit_key(username, request)
    _check_rate_limit(key)

    user = db.query(User).filter(User.username == username).first()
    now = datetime.now(timezone.utc)
    if user is not None and user.locked_until is not None:
        locked_until = user.locked_until if user.locked_until.tzinfo else user.locked_until.replace(tzinfo=timezone.utc)
        if locked_until > now:
            minutes = max(1, int((locked_until - now).total_seconds() // 60) + 1)
            record_audit(
                db,
                action="auth.login_blocked",
                request=request,
                actor_username=username,
                entity_type="user",
                entity_id=user.id,
                outcome="denied",
                detail={"reason": "account_locked", "minutes_left": minutes},
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Учётная запись временно заблокирована после серии неудачных попыток. Повторите через {minutes} мин.",
            )

    if user is None or not verify_password(payload.password, user.password_hash or ""):
        _register_failure(key)
        if user is not None:
            user.failed_login_count = int(user.failed_login_count or 0) + 1
            if user.failed_login_count >= settings.LOGIN_LOCKOUT_ATTEMPTS:
                user.locked_until = now + timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)
                user.failed_login_count = 0
                record_audit(
                    db,
                    action="auth.account_locked",
                    request=request,
                    actor_username=username,
                    actor_role=user.role,
                    entity_type="user",
                    entity_id=user.id,
                    outcome="denied",
                    detail={"minutes": settings.LOGIN_LOCKOUT_MINUTES, "reason": "too_many_failures"},
                )
            db.commit()
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

    # ── Второй фактор ──────────────────────────────────────────────────────
    recovery_index: int | None = None
    if user.totp_enabled and user.totp_secret:
        code = (payload.totp_code or "").strip()
        if not code:
            record_audit(
                db,
                action="auth.2fa_challenge",
                request=request,
                actor_username=username,
                actor_role=user.role,
                entity_type="user",
                entity_id=user.id,
                outcome="denied",
                detail={"reason": "code_required"},
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Требуется код двухфакторной аутентификации (2FA)",
                headers={"X-2FA-Required": "1"},
            )
        accepted = verify_totp(user.totp_secret, code)
        if not accepted:
            try:
                stored = json.loads(user.totp_recovery_json or "[]")
            except (TypeError, ValueError):
                stored = []
            if isinstance(stored, list):
                recovery_index = verify_recovery_code([str(item) for item in stored], code)
                accepted = recovery_index is not None
                if accepted:
                    stored.pop(recovery_index)
                    user.totp_recovery_json = json.dumps(stored)
        if not accepted:
            _register_failure(key)
            record_audit(
                db,
                action="auth.2fa_failed",
                request=request,
                actor_username=username,
                actor_role=user.role,
                entity_type="user",
                entity_id=user.id,
                outcome="denied",
                detail={"reason": "invalid_code"},
            )
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверный код 2FA. Проверьте время на телефоне или используйте резервный код.",
                headers={"X-2FA-Required": "1"},
            )

    user.failed_login_count = 0
    user.locked_until = None
    session = _issue_session(response, db, user)
    record_audit(
        db,
        action="auth.login",
        request=request,
        user=user,
        entity_type="user",
        entity_id=user.id,
        detail={
            "method": "password",
            "role": user.role,
            "2fa": bool(user.totp_enabled),
            "recovery_code": recovery_index is not None,
        },
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


# ─── Двухфакторная аутентификация (TOTP) ────────────────────────────────────

@router.get("/2fa/status")
def two_factor_status(user: User = Depends(get_current_user)):
    try:
        remaining = len(json.loads(user.totp_recovery_json or "[]"))
    except (TypeError, ValueError):
        remaining = 0
    return {"enabled": bool(user.totp_enabled), "recovery_codes_left": remaining}


@router.post("/2fa/setup")
def two_factor_setup(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Генерирует секрет и резервные коды. 2FA включается только после проверки кода."""
    db_user = db.query(User).filter(User.id == user.id).first()
    if db_user is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if db_user.totp_enabled:
        raise HTTPException(status_code=409, detail="2FA уже включена. Сначала отключите её.")

    secret = generate_secret()
    codes = generate_recovery_codes()
    db_user.totp_secret = secret
    db_user.totp_recovery_json = json.dumps([hash_recovery_code(code) for code in codes])
    db.commit()

    record_audit(
        db,
        action="auth.2fa_setup",
        request=request,
        user=db_user,
        entity_type="user",
        entity_id=db_user.id,
        detail={"recovery_codes": len(codes)},
    )
    return {
        "secret": secret,
        "otpauth_uri": provisioning_uri(secret, db_user.username),
        "recovery_codes": codes,
        "issuer": settings.TOTP_ISSUER,
    }


@router.post("/2fa/enable")
def two_factor_enable(
    payload: TotpCodeIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db_user = db.query(User).filter(User.id == user.id).first()
    if db_user is None or not db_user.totp_secret:
        raise HTTPException(status_code=400, detail="Сначала запустите настройку 2FA")
    if not verify_totp(db_user.totp_secret, payload.code):
        raise HTTPException(status_code=400, detail="Код не подошёл. Проверьте время на телефоне и попробуйте снова.")
    db_user.totp_enabled = True
    db.commit()
    record_audit(
        db,
        action="auth.2fa_enabled",
        request=request,
        user=db_user,
        entity_type="user",
        entity_id=db_user.id,
        detail={"method": "totp"},
    )
    return {"status": "enabled", "enabled": True}


@router.post("/2fa/disable")
def two_factor_disable(
    payload: PasswordOnlyIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db_user = db.query(User).filter(User.id == user.id).first()
    if db_user is None or not verify_password(payload.current_password, db_user.password_hash or ""):
        raise HTTPException(status_code=400, detail="Неверный пароль")
    db_user.totp_enabled = False
    db_user.totp_secret = None
    db_user.totp_recovery_json = "[]"
    db.commit()
    record_audit(
        db,
        action="auth.2fa_disabled",
        request=request,
        user=db_user,
        entity_type="user",
        entity_id=db_user.id,
        detail={"method": "password"},
    )
    return {"status": "disabled", "enabled": False}


@router.post("/password")
def change_own_password(
    payload: PasswordChangeIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db_user = db.query(User).filter(User.id == user.id).first()
    if db_user is None or not verify_password(payload.current_password, db_user.password_hash or ""):
        raise HTTPException(status_code=400, detail="Текущий пароль указан неверно")
    error = password_strength_error(payload.new_password)
    if error:
        raise HTTPException(status_code=400, detail=error)
    db_user.password_hash = hash_password(payload.new_password)
    db.commit()
    record_audit(
        db,
        action="auth.password_changed",
        request=request,
        user=db_user,
        entity_type="user",
        entity_id=db_user.id,
    )
    return {"status": "ok"}
