from __future__ import annotations

import hmac
import threading
import time
from collections import OrderedDict

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

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


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=12, max_length=256)


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
            employee_id = user.id
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
    with SessionLocal() as db:
        user = db.get(Employee, employee_id)
        if not user or not check_password(payload.current_password, user.password_hash):
            raise HTTPException(status_code=401, detail="Текущий пароль указан неверно")
        user.password_hash = hash_password(payload.new_password)
        revoke_sessions(db, employee_id)
        db.commit()
    response.delete_cookie("school_session", path="/")
    return {"changed": True}
