from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.db.models import AccessSession, Employee
from app.db.session import SessionLocal
from app.core.roles import get_role


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return f"scrypt${salt}${digest}"


def check_password(password: str, encoded: str) -> bool:
    try:
        scheme, salt, digest = encoded.split("$")
        if scheme != "scrypt":
            return False
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
        return hmac.compare_digest(actual, digest)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    # Rotating API_KEY also invalidates previously issued sessions.
    return hmac.new(settings.API_KEY.encode(), token.encode(), hashlib.sha256).hexdigest()


def issue_session(employee_id: int | None = None) -> str:
    token = secrets.token_urlsafe(48)
    with SessionLocal() as db:
        db.query(AccessSession).filter(AccessSession.expires_at < datetime.now(timezone.utc)).delete()
        db.add(AccessSession(token_hash=token_hash(token), employee_id=employee_id, expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.SESSION_TTL_SEC)))
        db.commit()
    return token


def principal_for_session(token: str) -> dict | None:
    if not token or len(token) > 256:
        return None
    with SessionLocal() as db:
        row = db.get(AccessSession, token_hash(token))
        if not row:
            return None
        expiry = row.expires_at.replace(tzinfo=timezone.utc) if row.expires_at.tzinfo is None else row.expires_at
        if expiry <= datetime.now(timezone.utc):
            return None
        if row.employee_id is None:
            return root_principal()
        user = db.get(Employee, row.employee_id)
        if not user or not user.is_active:
            return None
        role = get_role(db, user.role)
        if not role:
            return None
        return {"id": user.id, "username": user.username, "display_name": user.display_name, "role": user.role, "role_name": role["name"], "permissions": role["permissions"]}


def root_principal() -> dict:
    return {"id": None, "username": "system", "display_name": "Администратор системы", "role": "admin", "role_name": "Администратор", "permissions": ["review_incidents", "analyze_files"]}


def revoke_sessions(db, employee_id: int) -> None:
    db.query(AccessSession).filter(AccessSession.employee_id == employee_id).delete()
