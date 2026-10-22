from __future__ import annotations

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


class Settings(BaseSettings):
    PROJECT_NAME: str = "School Security Analytics System"
    DATABASE_URL: str = f"sqlite:///{(PROJECT_ROOT / 'school_security.db').as_posix()}"
    REDIS_URL: str = "redis://localhost:6379/0"

    YOLO_COCO_MODEL_PATH: Path = PROJECT_ROOT / "ml" / "models" / "yolov8n.pt"
    YOLO_WEAPON_MODEL_PATH: Path = PROJECT_ROOT / "ml" / "models" / "weapon_yolov8.pt"
    YOLO_CUSTOM_MODEL_PATH: Path = PROJECT_ROOT / "ml" / "models" / "school_security_best.pt"

    CONFIDENCE_THRESHOLD: float = 0.42
    WEAPON_CONFIDENCE_THRESHOLD: float = 0.50
    CUSTOM_CONFIDENCE_THRESHOLD: float = 0.52
    UNATTENDED_DISTANCE_RATIO: float = 0.22
    VIOLATION_COOLDOWN_SEC: int = 12

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

for sub in ("snapshots", "videos", "uploads"):
    (settings.MEDIA_ROOT / sub).mkdir(parents=True, exist_ok=True)
