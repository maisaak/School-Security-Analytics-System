from __future__ import annotations

import hmac
import base64
import hashlib
import secrets
import threading
import time
from collections import OrderedDict
from sqlalchemy import or_, update

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response
from pydantic import BaseModel, Field
from urllib.parse import quote
import struct
import time as wall_time

from app.core.config import settings
from app.core.security import create_session, verify_api_key
from app.core.accounts import check_password, hash_password, issue_session, revoke_sessions, token_hash
from app.db.models import AccessSession, Employee
from app.db.session import SessionLocal

router = APIRouter(prefix="/api/auth", tags=["auth"])
_attempts: OrderedDict[str, list[float]] = OrderedDict()
_lock = threading.Lock()


class Login(BaseModel):
    api_key: str | None = Field(default=None, min_length=1, max_length=512)
    username: str | None = Field(default=None, min_length=1, max_length=64)
    password: str | None = Field(default=None, min_length=1, max_length=256)
    totp_code: str | None = Field(default=None, min_length=6, max_length=8)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=12, max_length=256)


class TwoFactorConfirmation(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    code: str = Field(default="", max_length=6)


def _totp(secret: str, timestamp: int | None = None) -> str:
    counter = int((int(wall_time.time()) if timestamp is None else timestamp) // 30)
    digest = hmac.new(base64.b32decode(secret + "=" * ((8 - len(secret) % 8) % 8)), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 15
    return str((struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000).zfill(6)


def _valid_totp(secret: str | None, code: str | None) -> bool:
    if not secret or not code or len(code) != 6 or not code.isascii() or not code.isdigit():
        return False
    now = int(wall_time.time())
    return any(hmac.compare_digest(_totp(secret, now + drift), code) for drift in (-30, 0, 30))


def _consume_totp(db, user: Employee, code: str | None) -> bool:
    """Atomically consume a time step so simultaneous logins cannot replay it."""
    if not user.totp_secret or not code or len(code) != 6 or not code.isascii() or not code.isdigit():
        return False
    counter = int(wall_time.time()) // 30
    matching = [step for step in (counter - 1, counter, counter + 1)
                if hmac.compare_digest(_totp(user.totp_secret, step * 30), code)]
    if not matching:
        return False
    result = db.execute(update(Employee).where(
        Employee.id == user.id, Employee.totp_secret == user.totp_secret,
        Employee.totp_enabled.is_(True),
        or_(Employee.totp_last_counter.is_(None), Employee.totp_last_counter < max(matching)),
    ).values(totp_last_counter=max(matching)))
    return result.rowcount == 1


def _limit_security_attempts(request: Request, employee_id: int) -> None:
    key = f"security:{employee_id}"
    now = time.monotonic()
    with _lock:
        recent = [t for t in _attempts.get(key, []) if now - t < 60]
        if len(recent) >= 5:
            raise HTTPException(429, "Слишком много попыток. Повторите через минуту.")
        _attempts[key] = recent + [now]
        _attempts.move_to_end(key)
        while len(_attempts) > 4096:
            _attempts.popitem(last=False)


def _confirmed_user(db, request: Request, password: str):
    employee_id = request.state.principal.get("id")
    if employee_id is None:
        raise HTTPException(422, "Эта операция доступна только учётной записи сотрудника")
    _limit_security_attempts(request, employee_id)
    user = db.get(Employee, employee_id)
    if not user or not user.is_active or not check_password(password, user.password_hash):
        raise HTTPException(401, "Текущий пароль указан неверно")
    return user


@router.post("/login")
def login(payload: Login, request: Request, response: Response):
    if request.headers.get("X-Requested-With") != "SchoolSecurity":
        raise HTTPException(status_code=403, detail="Отсутствует защита CSRF")
    host = request.client.host if request.client else "unknown"
    now = time.monotonic()
    with _lock:
        recent = [t for t in _attempts.get(host, []) if now - t < 60]
        if len(recent) >= 5:
            raise HTTPException(status_code=429, detail="Слишком много попыток. Повторите через минуту.")
        _attempts[host] = recent + [now]
        _attempts.move_to_end(host)
        while len(_attempts) > 4096:
            _attempts.popitem(last=False)
    employee_id = None
    if payload.api_key:
        if not settings.API_KEY or not hmac.compare_digest(payload.api_key.encode(), settings.API_KEY.encode()):
            raise HTTPException(status_code=401, detail="Неверные данные для входа")
    else:
        with SessionLocal() as db:
            user = db.query(Employee).filter(Employee.username == (payload.username or "").strip().lower()).first()
            # Use the same expensive password function for unknown users.
            encoded = user.password_hash if user else hash_password("dummy-password-for-timing")
            valid = check_password(payload.password or "", encoded)
            if not user or not valid or not user.is_active:
                raise HTTPException(status_code=401, detail="Неверные данные для входа")
            if user.totp_enabled and not payload.totp_code:
                raise HTTPException(status_code=401, detail="Требуется код двухфакторной аутентификации")
            if user.totp_enabled and not _consume_totp(db, user, payload.totp_code):
                raise HTTPException(status_code=401, detail="Неверный код двухфакторной аутентификации")
            employee_id = user.id
            db.commit()
    response.set_cookie(
        "school_session", issue_session(employee_id), httponly=True, secure=settings.COOKIE_SECURE,
        samesite="strict", max_age=settings.SESSION_TTL_SEC, path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": True}


@router.get("/session", dependencies=[Depends(verify_api_key)])
def session(response: Response, request: Request):
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": True, "dev_mode": settings.DEV_MODE, "user": request.state.principal}


@router.post("/logout", dependencies=[Depends(verify_api_key)])
def logout(response: Response, request: Request):
    with SessionLocal() as db:
        db.query(AccessSession).filter(AccessSession.token_hash == token_hash(request.cookies.get("school_session", ""))).delete()
        db.commit()
    response.delete_cookie("school_session", path="/")
    return {"authenticated": False}


@router.get("/sessions", dependencies=[Depends(verify_api_key)])
def sessions(request: Request):
    """Return safe metadata for the current employee's active sessions."""
    with SessionLocal() as db:
        rows = db.query(AccessSession).filter(AccessSession.employee_id == request.state.principal.get("id")).order_by(AccessSession.expires_at.desc()).all()
        return [{"expires_at": row.expires_at, "current": row.token_hash == token_hash(request.cookies.get("school_session", ""))} for row in rows]


@router.post("/sessions/revoke-all", dependencies=[Depends(verify_api_key)])
def revoke_all_sessions(request: Request, response: Response):
    employee_id = request.state.principal.get("id")
    if employee_id is None:
        raise HTTPException(status_code=422, detail="Для API-ключа нет пользовательских сессий")
    with SessionLocal() as db:
        revoke_sessions(db, employee_id)
    response.delete_cookie("school_session", path="/")
    return {"revoked": True}


@router.post("/password", dependencies=[Depends(verify_api_key)])
def change_password(payload: PasswordChange, request: Request, response: Response):
    employee_id = request.state.principal.get("id")
    if employee_id is None:
        raise HTTPException(status_code=422, detail="Пароль API-ключа меняется в .env")
    _limit_security_attempts(request, employee_id)
    with SessionLocal() as db:
        user = db.get(Employee, employee_id)
        if not user or not check_password(payload.current_password, user.password_hash):
            raise HTTPException(status_code=401, detail="Текущий пароль указан неверно")
        user.password_hash = hash_password(payload.new_password)
        revoke_sessions(db, employee_id)
        db.commit()
    response.delete_cookie("school_session", path="/")
    return {"changed": True}


@router.get("/2fa", dependencies=[Depends(verify_api_key)])
def two_factor_status(request: Request):
    employee_id = request.state.principal.get("id")
    if employee_id is None:
        return {"enabled": False, "available": False}
    with SessionLocal() as db:
        user = db.get(Employee, employee_id)
        return {"enabled": bool(user and user.totp_enabled), "available": True}


@router.post("/2fa/setup", dependencies=[Depends(verify_api_key)])
def two_factor_setup(payload: TwoFactorConfirmation, request: Request, response: Response):
    employee_id = request.state.principal.get("id")
    if employee_id is None:
        raise HTTPException(status_code=422, detail="Для API-ключа 2FA настраивается отдельно")
    secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
    with SessionLocal() as db:
        user = _confirmed_user(db, request, payload.current_password)
        if user.totp_enabled:
            raise HTTPException(409, "2FA уже включена. Сначала подтвердите её отключение.")
        user.totp_pending_secret = secret
        user.totp_pending_expires = int(wall_time.time()) + 600
        db.commit()
        label = quote(f"School Security:{user.username}")
    response.headers["Cache-Control"] = "no-store"
    return {"secret": secret, "otpauth_url": f"otpauth://totp/{label}?secret={secret}&issuer=School%20Security"}


@router.post("/2fa/enable", dependencies=[Depends(verify_api_key)])
def two_factor_enable(request: Request, code: str = Form(..., min_length=6, max_length=6)):
    employee_id = request.state.principal.get("id")
    if employee_id is None:
        raise HTTPException(422, "Требуется учётная запись сотрудника")
    _limit_security_attempts(request, employee_id)
    with SessionLocal() as db:
        user = db.get(Employee, employee_id)
        if user and user.totp_enabled:
            raise HTTPException(409, "2FA уже включена")
        if not user or not user.totp_pending_expires or user.totp_pending_expires < int(wall_time.time()) or not _valid_totp(user.totp_pending_secret, code):
            raise HTTPException(status_code=422, detail="Неверный код подтверждения")
        secret = user.totp_pending_secret
        counter = int(wall_time.time()) // 30
        matched = max(step for step in (counter - 1, counter, counter + 1) if hmac.compare_digest(_totp(secret, step * 30), code))
        updated = db.execute(update(Employee).where(Employee.id == employee_id, Employee.totp_enabled.is_(False), Employee.totp_pending_secret == secret).values(
            totp_secret=secret, totp_enabled=True, totp_pending_secret=None, totp_pending_expires=None, totp_last_counter=matched))
        if updated.rowcount != 1:
            raise HTTPException(409, "Настройка изменилась. Повторите подключение.")
        current = token_hash(request.cookies.get("school_session", ""))
        db.query(AccessSession).filter(AccessSession.employee_id == employee_id, AccessSession.token_hash != current).delete()
        db.commit()
    return {"enabled": True}


@router.post("/2fa/disable", dependencies=[Depends(verify_api_key)])
def two_factor_disable(payload: TwoFactorConfirmation, request: Request):
    employee_id = request.state.principal.get("id")
    with SessionLocal() as db:
        user = _confirmed_user(db, request, payload.current_password)
        if not user.totp_enabled or not _consume_totp(db, user, payload.code):
            raise HTTPException(422, "Требуется новый код из приложения-аутентификатора")
        user.totp_enabled = False
        user.totp_secret = None
        user.totp_pending_secret = None
        user.totp_pending_expires = None
        user.totp_last_counter = None
        current = token_hash(request.cookies.get("school_session", ""))
        db.query(AccessSession).filter(AccessSession.employee_id == employee_id, AccessSession.token_hash != current).delete()
        db.commit()
    return {"enabled": False}
