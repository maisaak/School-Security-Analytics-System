from __future__ import annotations

from pathlib import Path
import sys
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _resolve_repo_path(p: Path) -> Path:
    if p.is_absolute():
        return p
    return (PROJECT_ROOT / p).resolve()


class Settings(BaseSettings):
    PROJECT_NAME: str = "School Security Analytics System"
    DATABASE_URL: str = f"sqlite:///{(PROJECT_ROOT / 'school_security.db').as_posix()}"
    REDIS_URL: str = "redis://localhost:6379/0"

    API_KEY: str = ""
    DEV_MODE: bool = False
    SEED_DEMO_CAMERAS: bool = False
    COOKIE_SECURE: bool = False  # Enable behind HTTPS outside localhost.
    SESSION_TTL_SEC: int = 28800
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000"]
    ALLOW_PRIVATE_RTSP: bool = True
    ALLOW_LOCAL_WEBCAM: bool = False
    CAMERA_ALLOWED_HOSTS: list[str] = []
    ALLOW_HTTP_CAMERAS: bool = False
    UPLOAD_RETENTION_HOURS: int = 24

    MAX_UPLOAD_IMAGE_MB: int = 15
    MAX_UPLOAD_VIDEO_MB: int = 60
    MAX_STORED_VIOLATIONS: int = 250
    MAX_CAMERAS: int = 16
    MAX_VIDEO_DURATION_SEC: int = 120
    ENABLE_LOCAL_TRAINING: bool = True
    TRAINING_TIMEOUT_SEC: int = 7200
    UNATTENDED_MIN_SECONDS: float = 30.0
    DETECTION_CONFIRMATIONS: int = 2

    YOLO_COCO_MODEL_PATH: Path = PROJECT_ROOT / "ml" / "models" / "yolov8n.pt"
    YOLO_WEAPON_MODEL_PATH: Path = PROJECT_ROOT / "ml" / "models" / "weapon_yolov8.pt"
    YOLO_CUSTOM_MODEL_PATH: Path = PROJECT_ROOT / "ml" / "models" / "active.pt"

    CONFIDENCE_THRESHOLD: float = 0.42
    WEAPON_CONFIDENCE_THRESHOLD: float = 0.50
    CUSTOM_CONFIDENCE_THRESHOLD: float = 0.52
    UNATTENDED_DISTANCE_RATIO: float = 0.22
    VIOLATION_COOLDOWN_SEC: int = 12

    MEDIA_ROOT: Path = PROJECT_ROOT / "media"
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""
    NOTIFICATION_WEBHOOK_URL: str = ""
    NOTIFICATION_COOLDOWN_SEC: int = 60
    NOTIFICATION_TIMEOUT_SEC: int = 5
    SERVER_UPDATES_ENABLED: bool = False
    SERVER_UPDATE_STATE_DIR: Path = Path("/var/lib/school-security-updater")

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

for sub in ("snapshots", "videos", "uploads"):
    (settings.MEDIA_ROOT / sub).mkdir(parents=True, exist_ok=True)
