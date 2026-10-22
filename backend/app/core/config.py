from __future__ import annotations

import secrets
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _resolve_repo_path(p: Path) -> Path:
    if p.is_absolute():
        return p
    if p.exists():
        return p.resolve()
    cand_root = (PROJECT_ROOT / p).resolve()
    if cand_root.exists():
        return cand_root
    cand_backend = (PROJECT_ROOT / "backend" / p).resolve()
    if cand_backend.exists():
        return cand_backend
    return cand_root


def _load_or_create_jwt_secret() -> str:
    """Стабильный секрет JWT для dev-режима, если он не задан через .env / переменные окружения."""
    secret_file = PROJECT_ROOT / ".jwt_secret"
    if secret_file.is_file():
        value = secret_file.read_text(encoding="utf-8").strip()
        if value:
            return value
    value = secrets.token_urlsafe(48)
    try:
        secret_file.write_text(value, encoding="utf-8")
        secret_file.chmod(0o600)
    except OSError:
        pass
    return value


class Settings(BaseSettings):
    PROJECT_NAME: str = "School Security Analytics System v2"
    APP_VERSION: str = "2.0.0"

    DATABASE_URL: str = f"sqlite:///{(PROJECT_ROOT / 'school_security.db').as_posix()}"
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── Аутентификация и сессии ───────────────────────────────────────────────
    JWT_SECRET_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 12 * 60
    AUTH_COOKIE_NAME: str = "school_session"
    # Дублировать токен в теле ответа логина: нужно для превью/iframe, где браузер
    # блокирует сторонние cookie. В строгом production можно выключить.
    AUTH_RETURN_TOKEN_IN_BODY: bool = True
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"
    DEMO_LOGIN_ENABLED: bool = True
    LOGIN_RATE_LIMIT_ATTEMPTS: int = 12
    LOGIN_RATE_LIMIT_WINDOW_SEC: int = 300

    # ── Демо-аккаунты (создаются при первом старте, флаг is_demo=True) ────────
    DEMO_ADMIN_USERNAME: str = "admin"
    DEMO_ADMIN_PASSWORD: str = "admin123"
    DEMO_DIRECTOR_USERNAME: str = "director"
    DEMO_DIRECTOR_PASSWORD: str = "director123"
    DEMO_GUARD_USERNAME: str = "guard"
    DEMO_GUARD_PASSWORD: str = "guard123"

    API_KEY: str = ""
    CORS_ORIGINS: list[str] = ["*"]
    ALLOW_PRIVATE_RTSP: bool = True
    ALLOW_LOCAL_WEBCAM: bool = False

    MAX_UPLOAD_IMAGE_MB: int = 15
    MAX_UPLOAD_VIDEO_MB: int = 60
    MAX_STORED_VIOLATIONS: int = 250

    YOLO_COCO_MODEL_PATH: Path = PROJECT_ROOT / "ml" / "models" / "yolov8n.pt"
    YOLO_WEAPON_MODEL_PATH: Path = PROJECT_ROOT / "ml" / "models" / "weapon_yolov8.pt"
    YOLO_CUSTOM_MODEL_PATH: Path = PROJECT_ROOT / "ml" / "models" / "school_security_best.pt"

    # ── Реестр версий весов и Validation Gate ────────────────────────────────
    MODEL_VERSIONS_ROOT: Path = PROJECT_ROOT / "ml" / "versions"
    MAP50_ROLLBACK_TOLERANCE: float = 0.01
    MAP50_MIN_ABSOLUTE: float = 0.35

    CONFIDENCE_THRESHOLD: float = 0.42
    WEAPON_CONFIDENCE_THRESHOLD: float = 0.50
    CUSTOM_CONFIDENCE_THRESHOLD: float = 0.52
    UNATTENDED_DISTANCE_RATIO: float = 0.22

    # ── Трекинг и таймер выдержки бесхозной сумки (ByteTrack-подобный) ────────
    TRACKER_ENABLED: bool = True
    TRACK_IOU_THRESHOLD: float = 0.25
    TRACK_MAX_AGE_SEC: float = 3.0
    TRACK_MIN_HITS: int = 2
    UNATTENDED_DWELL_SEC: float = 6.0
    BAG_RELEASE_GRACE_SEC: float = 1.5
    VIOLATION_COOLDOWN_SEC: int = 12
    STREAM_TARGET_FPS: float = 12.0
    DETECT_EVERY_N_FRAMES: int = 3

    MEDIA_ROOT: Path = PROJECT_ROOT / "media"

    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        extra="ignore",
    )


settings = Settings()

if settings.DATABASE_URL == "sqlite:///./school_security.db":
    settings.DATABASE_URL = f"sqlite:///{(PROJECT_ROOT / 'school_security.db').as_posix()}"

settings.YOLO_COCO_MODEL_PATH = _resolve_repo_path(settings.YOLO_COCO_MODEL_PATH)
settings.YOLO_WEAPON_MODEL_PATH = _resolve_repo_path(settings.YOLO_WEAPON_MODEL_PATH)
settings.YOLO_CUSTOM_MODEL_PATH = _resolve_repo_path(settings.YOLO_CUSTOM_MODEL_PATH)
settings.MEDIA_ROOT = _resolve_repo_path(settings.MEDIA_ROOT)
settings.MODEL_VERSIONS_ROOT = _resolve_repo_path(settings.MODEL_VERSIONS_ROOT)

if not (settings.JWT_SECRET_KEY or "").strip():
    settings.JWT_SECRET_KEY = _load_or_create_jwt_secret()

for sub in ("snapshots", "videos", "uploads"):
    (settings.MEDIA_ROOT / sub).mkdir(parents=True, exist_ok=True)
settings.MODEL_VERSIONS_ROOT.mkdir(parents=True, exist_ok=True)
