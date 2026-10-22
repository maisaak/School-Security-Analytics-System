from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import re
import secrets
import socket
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse
import jwt
from fastapi import Depends, HTTPException, Query, Request, UploadFile, status
from fastapi.security import APIKeyHeader

from app.core.config import PROJECT_ROOT, settings

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

PBKDF2_ITERATIONS = 210_000
_PASSWORD_SCHEME = "pbkdf2_sha256"


# ─── Хеширование паролей (PBKDF2-HMAC-SHA256, без внешних зависимостей) ──────

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ITERATIONS)
    return f"{_PASSWORD_SCHEME}${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iterations, salt, digest_hex = (stored or "").split("$", 3)
        if scheme != _PASSWORD_SCHEME:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("utf-8"), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def password_strength_error(password: str) -> str | None:
    if len(password or "") < 6:
        return "Пароль должен содержать минимум 6 символов"
    if len(password) > 128:
        return "Пароль слишком длинный (максимум 128 символов)"
    return None


# ─── JWT access-токены ───────────────────────────────────────────────────────

def create_access_token(
    subject: str,
    *,
    username: str,
    role: str,
    extra: dict[str, Any] | None = None,
    expires_minutes: int | None = None,
) -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=expires_minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload: dict[str, Any] = {
        "sub": subject,
        "username": username,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": secrets.token_urlsafe(12),
        "iss": "school-security-analytics",
    }
    if extra:
        payload.update(extra)
    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return token, expires_at


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(
        token,
        settings.JWT_SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
        options={"require": ["exp", "sub"]},
    )


# ─── Маскирование секретов (rtsp://user:pass@host) ───────────────────────────

_SECRET_KEYS = re.compile(
    r"(pass(?:word)?|pwd|secret|token|api[_-]?key|authorization|cookie|jwt)",
    re.IGNORECASE,
)


def mask_stream_url(raw_url: str | None) -> str:
    """
    Скрывает логин/пароль в URL потока перед отдачей на фронтенд или в журнал аудита:
    rtsp://admin:SuperPass@10.0.0.5:554/live -> rtsp://admin:***@10.0.0.5:554/live
    Логин сохраняется частично (первый символ), чтобы администратор понимал, чья это учётка.
    """
    if not raw_url:
        return raw_url or ""
    try:
        parsed = urlparse(raw_url)
    except ValueError:
        return "***"
    if not parsed.netloc or "@" not in parsed.netloc:
        return raw_url

    userinfo, _, hostport = parsed.netloc.rpartition("@")
    if ":" in userinfo:
        user, _, _password = userinfo.partition(":")
    else:
        user, _password = userinfo, ""

    masked_user = f"{user[0]}***" if user else "***"
    masked_netloc = f"{masked_user}:***@{hostport}"
    return urlunparse(parsed._replace(netloc=masked_netloc))


def redact_secrets(value: Any) -> Any:
    """Рекурсивно вычищает пароли/токены из структур перед записью в AuditLog."""
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            if _SECRET_KEYS.search(str(key)):
                cleaned[key] = "***"
            elif isinstance(key, str) and key.lower() in {"rtsp_url", "stream_url", "source_url", "url"}:
                cleaned[key] = mask_stream_url(item) if isinstance(item, str) else item
            else:
                cleaned[key] = redact_secrets(item)
        return cleaned
    if isinstance(value, (list, tuple)):
        return [redact_secrets(v) for v in value]
    if isinstance(value, str) and "://" in value and "@" in value:
        return mask_stream_url(value)
    return value


def redact_text(text: str) -> str:
    """Маскирует учётные данные вида scheme://user:pass@host внутри произвольного текста."""
    return re.sub(
        r"([a-zA-Z][a-zA-Z0-9+.-]*://)([^/\s:@]+):([^/\s@]+)@",
        lambda m: f"{m.group(1)}{m.group(2)[:1]}***:***@",
        text or "",
    )

ALLOWED_SIM_SOURCES = {"sim://entrance", "sim://hallway", "sim://courtyard", "demo://school-entrance"}
ALLOWED_SCHEMES = {"rtsp", "rtsps", "http", "https"}
BLOCKED_HOSTNAMES = {"localhost", "db", "postgres", "redis", "backend", "celery_worker", "metadata.google.internal"}


def verify_api_key(
    header_key: str | None = Depends(api_key_header),
    query_key: str | None = Query(default=None, alias="api_key"),
) -> None:
    """
    Опциональная защита API-ключом: если в .env задан API_KEY, все запросы обязаны
    передавать заголовок X-API-Key (либо ?api_key= для MJPEG/MP4 тегов браузера).
    """
    configured = (settings.API_KEY or "").strip()
    if not configured:
        return
    provided = (header_key or query_key or "").strip()
    if not provided or not hmac.compare_digest(provided, configured):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный или отсутствующий API-ключ (X-API-Key)",
        )


def validate_stream_source(raw_url: str) -> str:
    """
    Блокирует LFI (чтение произвольных локальных файлов через OpenCV/FFmpeg) и SSRF
    во внутренние сервисы Docker / облачные метаданные (169.254.169.254, 127.0.0.1 и т.д.).
    """
    url = raw_url.strip()
    if url in ALLOWED_SIM_SOURCES or url.startswith("sim://"):
        sim_name = url.removeprefix("sim://").strip("/")
        if sim_name not in {"entrance", "hallway", "courtyard"}:
            raise HTTPException(status_code=400, detail="Допустимые стенды: sim://entrance, sim://hallway, sim://courtyard")
        return f"sim://{sim_name}"

    if url == "webcam":
        if not settings.ALLOW_LOCAL_WEBCAM:
            raise HTTPException(status_code=400, detail="Локальная веб-камера отключена политикой безопасности")
        return url

    parsed = urlparse(url)
    if parsed.scheme.lower() not in ALLOWED_SCHEMES or not parsed.hostname:
        raise HTTPException(
            status_code=400,
            detail="Разрешены только потоки rtsp://, rtsps://, http(s):// или виртуальные стенды sim://",
        )

    host = parsed.hostname.lower()
    if host in BLOCKED_HOSTNAMES:
        raise HTTPException(status_code=400, detail=f"Хост '{host}' заблокирован защитой от SSRF")

    # Проверяем IP-литерал или DNS-резолвинг против loopback и link-local (169.254.0.0/16)
    candidate_ips: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    try:
        candidate_ips.append(ipaddress.ip_address(host))
    except ValueError:
        try:
            infos = socket.getaddrinfo(host, None)
            for info in infos:
                candidate_ips.append(ipaddress.ip_address(info[4][0]))
        except Exception:
            # В закрытой сети DNS-имя камеры может резолвиться позже, но запрещённые имена уже отсечены
            pass

    for ip_obj in candidate_ips:
        if ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_multicast or ip_obj.is_unspecified:
            raise HTTPException(
                status_code=400,
                detail=f"Адрес {ip_obj} (loopback / link-local metadata) заблокирован защитой от SSRF",
            )
        if ip_obj.is_private and not settings.ALLOW_PRIVATE_RTSP:
            raise HTTPException(
                status_code=400,
                detail="Приватные IP-адреса отключены настройкой ALLOW_PRIVATE_RTSP=false",
            )

    return url


def validate_dataset_yaml(path_str: str) -> Path:
    """Гарантирует, что путь конфигурации датасета строго находится внутри ml/datasets/."""
    allowed_dir = (PROJECT_ROOT / "ml" / "datasets").resolve()
    candidate = Path(path_str.strip())
    resolved = candidate.resolve() if candidate.is_absolute() else (PROJECT_ROOT / candidate).resolve()

    try:
        resolved.relative_to(allowed_dir)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="Недопустимый путь dataset_yaml: разрешены только файлы внутри ml/datasets/",
        ) from exc

    if resolved.suffix.lower() not in {".yaml", ".yml"} or not resolved.is_file():
        raise HTTPException(status_code=400, detail="Конфигурационный YAML-файл датасета не найден")

    return resolved


def safe_delete_media_file(media_url: str | None) -> bool:
    """Безопасно удаляет файл из MEDIA_ROOT с проверкой отсутствия выхода за пределы директории."""
    if not media_url or not media_url.startswith("/media/"):
        return False
    rel = media_url.removeprefix("/media/")
    media_root = settings.MEDIA_ROOT.resolve()
    target = (media_root / rel).resolve()
    try:
        target.relative_to(media_root)
    except ValueError:
        return False
    if target.is_file():
        target.unlink(missing_ok=True)
        return True
    return False


async def read_upload_limited(file: UploadFile, max_bytes: int) -> bytes:
    """Потоково читает загружаемый файл с жёстким лимитом размера для защиты от OOM / DoS."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Превышен допустимый размер файла (максимум {max_bytes // (1024 * 1024)} МБ)",
            )
        chunks.append(chunk)

    if total == 0:
        raise HTTPException(status_code=400, detail="Передан пустой файл")

    return b"".join(chunks)
