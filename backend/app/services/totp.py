from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

from app.core.config import settings


def generate_secret(length: int = 20) -> str:
    """Base32-секрет без padding — стандартный формат для приложений-аутентификаторов."""
    return base64.b32encode(secrets.token_bytes(length)).decode("ascii").rstrip("=")


def _normalize(secret: str) -> bytes:
    raw = (secret or "").strip().replace(" ", "").upper()
    padding = "=" * (-len(raw) % 8)
    return base64.b32decode(raw + padding, casefold=True)


def totp_code(secret: str, at: float | None = None, step: int = 30, digits: int = 6) -> str:
    """RFC 6238 (TOTP, SHA-1) — совместимо с Google Authenticator, Aegis, 1Password."""
    counter = int((at if at is not None else time.time()) // step)
    digest = hmac.new(_normalize(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10**digits)).zfill(digits)


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    """Проверяет код с окном ±window шагов (устойчиво к рассинхрону часов)."""
    candidate = "".join(ch for ch in (code or "") if ch.isdigit())
    if len(candidate) != 6:
        return False
    now = time.time()
    for shift in range(-window, window + 1):
        if hmac.compare_digest(totp_code(secret, at=now + shift * 30), candidate):
            return True
    return False


def provisioning_uri(secret: str, username: str, issuer: str | None = None) -> str:
    issuer_name = issuer or settings.TOTP_ISSUER
    label = quote(f"{issuer_name}:{username}")
    params = (
        f"secret={secret}&issuer={quote(issuer_name)}"
        "&algorithm=SHA1&digits=6&period=30"
    )
    return f"otpauth://totp/{label}?{params}"


def generate_recovery_codes(count: int = 8) -> list[str]:
    return [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(count)]


def hash_recovery_code(code: str) -> str:
    return hashlib.sha256((code or "").strip().lower().encode("utf-8")).hexdigest()


def verify_recovery_code(stored_hashes: list[str], code: str) -> int | None:
    """Возвращает индекс использованного кода, чтобы его можно было погасить."""
    target = hash_recovery_code(code)
    for index, stored in enumerate(stored_hashes):
        if hmac.compare_digest(str(stored), target):
            return index
    return None
