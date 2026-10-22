from __future__ import annotations

from typing import Callable

import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import Permission, has_permission, role_permissions
from app.core.security import decode_access_token
from app.db.models import User
from app.db.session import get_db
from app.services.audit import record_audit


def extract_token(request: Request) -> str | None:
    """
    Токен берём в порядке приоритета:
      1. HttpOnly cookie — работает для fetch/XHR, а также для <img MJPEG> и <video MP4>,
         которые браузер запрашивает без возможности добавить Authorization-заголовок.
      2. Authorization: Bearer — для внешних интеграций, Swagger и Postman.
      3. ?token= — запасной вариант для плееров, не отправляющих cookie.
    """
    cookie_token = request.cookies.get(settings.AUTH_COOKIE_NAME)
    if cookie_token:
        return cookie_token

    header = request.headers.get("authorization") or ""
    if header.lower().startswith("bearer "):
        return header[7:].strip()

    query_token = request.query_params.get("token")
    if query_token:
        return query_token.strip()
    return None


def set_auth_cookie(response: Response, token: str, max_age_seconds: int) -> None:
    response.set_cookie(
        key=settings.AUTH_COOKIE_NAME,
        value=token,
        max_age=max_age_seconds,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,  # type: ignore[arg-type]
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=settings.AUTH_COOKIE_NAME, path="/")


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Требуется авторизация. Войдите в систему заново.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token = extract_token(request)
    if not token:
        raise credentials_error
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Сессия истекла, войдите повторно",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except jwt.PyJWTError as exc:
        raise credentials_error from exc

    try:
        user_id = int(payload.get("sub", 0))
    except (TypeError, ValueError) as exc:
        raise credentials_error from exc

    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Учётная запись не найдена или отключена администратором",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_permissions(*permissions: Permission | str) -> Callable[..., User]:
    """Фабрика зависимостей RBAC: 403 + запись в AuditLog при попытке несанкционированного доступа."""
    required = [p if isinstance(p, Permission) else Permission(str(p)) for p in permissions]

    def dependency(
        request: Request,
        db: Session = Depends(get_db),
        user: User = Depends(get_current_user),
    ) -> User:
        missing = [p.value for p in required if not has_permission(user.role, p)]
        if missing:
            record_audit(
                db,
                action="access.denied",
                request=request,
                user=user,
                entity_type="endpoint",
                entity_id=request.url.path,
                outcome="denied",
                detail={"required": [p.value for p in required], "missing": missing, "method": request.method},
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Недостаточно прав для роли '{user.role}'. Требуется: {', '.join(missing)}"
                ),
            )
        return user

    return dependency


def user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
        "is_demo": user.is_demo,
        "permissions": role_permissions(user.role),
        "created_at": user.created_at,
        "last_login_at": user.last_login_at,
    }
