from __future__ import annotations

import hmac
import hashlib
import secrets
import time
import ipaddress
import socket
from pathlib import Path
from urllib.parse import urlparse
from fastapi import Depends, HTTPException, Request, UploadFile, status
from fastapi.security import APIKeyHeader

from app.core.config import PROJECT_ROOT, settings
from app.core.accounts import issue_session, principal_for_session, root_principal

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

ALLOWED_SIM_SOURCES = {"sim://entrance", "sim://hallway", "sim://courtyard", "demo://school-entrance"}
ALLOWED_SCHEMES = {"rtsp", "rtsps", "http", "https"}
BLOCKED_HOSTNAMES = {"localhost", "db", "postgres", "redis", "backend", "celery_worker", "metadata.google.internal"}


def verify_api_key(
    request: Request,
    header_key: str | None = Depends(api_key_header),
) -> None:
    configured = (settings.API_KEY or "").strip()
    if not configured:
        if settings.DEV_MODE:
            request.state.principal = root_principal()
            return
        raise HTTPException(status_code=503, detail="Администратор должен настроить API_KEY")
    if header_key and hmac.compare_digest(header_key.encode(), configured.encode()):
        request.state.principal = root_principal()
        return
    principal = principal_for_session(request.cookies.get("school_session", ""))
    if principal:
        if request.method not in {"GET", "HEAD", "OPTIONS"} and request.headers.get("X-Requested-With") != "SchoolSecurity":
            raise HTTPException(status_code=403, detail="Отсутствует защита CSRF")
        request.state.principal = principal
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            path = request.url.path.rstrip("/")
            if path in {"/api/auth/logout", "/api/preferences"}:
                return
            permissions = principal.get("permissions", [])
            permitted = (path == "/api/analyze/upload" and "analyze_files" in permissions) or (path.startswith("/api/violations/") and (path.endswith("/ack") or path.endswith("/review")) and "review_incidents" in permissions) or (path.startswith("/api/cameras") and "manage_cameras" in permissions)
            if principal["role"] != "admin" and not permitted:
                raise HTTPException(status_code=403, detail="Недостаточно прав для этого действия")
        return
    raise HTTPException(status_code=401, detail="Требуется вход в систему")


def create_session() -> str:
    return issue_session()


def valid_session(token: str) -> bool:
    return principal_for_session(token) is not None


def require_admin(request: Request, _: None = Depends(verify_api_key)) -> None:
    principal = request.state.principal
    path = request.url.path
    permission_by_path = {
        "/api/employees": "manage_employees",
        "/api/roles": "manage_employees",
        "/api/models": "manage_models",
        "/api/system/diagnostics": "manage_models",
    }
    permission = next((value for prefix, value in permission_by_path.items() if path.startswith(prefix)), None)
    if principal["role"] != "admin" and permission not in principal.get("permissions", []):
        raise HTTPException(status_code=403, detail="Требуются права администратора")


def require_permission(permission: str):
    def dependency(request: Request, _: None = Depends(verify_api_key)) -> None:
        principal = request.state.principal
        if principal["role"] != "admin" and permission not in principal.get("permissions", []):
            raise HTTPException(status_code=403, detail="Недостаточно прав для этой операции")
    return dependency


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
    if parsed.scheme.lower() in {"http", "https"} and not settings.ALLOW_HTTP_CAMERAS:
        raise HTTPException(status_code=400, detail="HTTP-камеры отключены. Используйте RTSP или настройте доверенную HTTP-камеру отдельно.")
    if not settings.DEV_MODE:
        if host not in settings.CAMERA_ALLOWED_HOSTS:
            raise HTTPException(status_code=400, detail="Добавьте IP камеры в CAMERA_ALLOWED_HOSTS на сервере")
        try:
            ipaddress.ip_address(host)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="В рабочем режиме требуется статический IP камеры, а не DNS-имя") from exc
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
        except socket.gaierror as exc:
            raise HTTPException(status_code=400, detail="Не удалось разрешить DNS-имя камеры") from exc

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


def read_upload_sync(file: UploadFile, max_bytes: int) -> bytes:
    chunks = []
    total = 0
    while chunk := file.file.read(1024 * 1024):
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=413, detail="Превышен допустимый размер файла")
        chunks.append(chunk)
    if not total:
        raise HTTPException(status_code=400, detail="Передан пустой файл")
    return b"".join(chunks)


def redact_stream_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme in {"sim", "demo", "lab"}:
        return url
    # Paths and query parameters may contain embedded access tokens too.
    return parsed._replace(netloc=parsed.netloc.rsplit("@", 1)[-1], path="/…", query="", fragment="").geturl()
