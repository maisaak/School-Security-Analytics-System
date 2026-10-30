from __future__ import annotations

import threading
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.core.config import PROJECT_ROOT, settings
from app.core.security import require_admin, verify_api_key
from app.db.models import AppSetting
from app.db.session import get_db
from app.models.detector import detector
from app.services.model_download import download_official_weights
from app.services.incident_recording import RecordingSettings

router = APIRouter(prefix="/api", dependencies=[Depends(verify_api_key)])
MODEL_LOCK = threading.Lock()
RECORDING_LOCK = threading.Lock()
recording_settings = RecordingSettings()


@router.get("/recording-settings")
def get_recording_settings():
    return recording_settings


@router.put("/recording-settings", dependencies=[Depends(require_admin)])
def set_recording_settings(payload: RecordingSettings, db: Session = Depends(get_db)):
    from app.services.stream_manager import stream_manager
    global recording_settings
    with RECORDING_LOCK:
        db.merge(AppSetting(key="incident_recording", value=payload.model_dump_json()))
        db.commit()
        recording_settings = payload
        stream_manager.configure_recording(payload)
    return payload
MODEL_CATALOG = {
    f"{family}{size}": {"id": f"{family}{size}", "label": f"{'YOLOv8' if family == 'yolov8' else 'YOLO11'} · {size.upper()}", "filename": f"{family}{size}.pt"}
    for family in ("yolov8", "yolo11") for size in ("n", "s", "m", "l", "x")
}


class Preferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    columns: Literal[1, 2, 3, 4, 5, 6, 7, 8] = 3
    show_stats: bool = True
    show_archive: bool = True
    show_alerts: bool = True
    compact: bool = False
    default_tab: Literal["dashboard", "monitoring", "analytics", "lab", "training", "settings"] = "dashboard"
    theme: Literal["dark", "light", "system"] = "dark"
    accent: str = Field(default="#6366f1", pattern=r"^#[0-9a-fA-F]{6}$")
    animations: bool = True
    rounding: Literal["none", "small", "large"] = "large"
    liquid_glass: bool = True
    transparency: int = Field(default=25, ge=0, le=70)

    @field_validator("accent", mode="before")
    @classmethod
    def migrate_accent(cls, value):
        return {"indigo": "#6366f1", "blue": "#3b82f6", "emerald": "#10b981", "violet": "#8b5cf6", "rose": "#f43f5e"}.get(value, value)


def preferences_key(request: Request) -> str:
    user_id = request.state.principal["id"]
    return f"preferences:{user_id if user_id is not None else 'system'}"


@router.get("/preferences")
def get_preferences(request: Request, db: Session = Depends(get_db)):
    row = db.get(AppSetting, preferences_key(request))
    return Preferences.model_validate_json(row.value) if row else Preferences()


@router.put("/preferences")
def set_preferences(payload: Preferences, request: Request, db: Session = Depends(get_db)):
    db.merge(AppSetting(key=preferences_key(request), value=payload.model_dump_json()))
    db.commit()
    return payload


@router.get("/models/catalog")
def model_catalog():
    return {"models": [{**entry, "installed": (PROJECT_ROOT / "ml" / "models" / entry["filename"]).is_file()} for entry in MODEL_CATALOG.values()], "active_base": detector.base_weights_name, "custom_weights": detector.active_weights_name if detector.custom_model is not None else None}


class ModelSelection(BaseModel):
    model_id: str
    allow_download: bool = False


class DetectionThresholds(BaseModel):
    confidence: float = Field(default=0.42, ge=0.05, le=0.99)
    weapon_confidence: float = Field(default=0.50, ge=0.05, le=0.99)
    custom_confidence: float = Field(default=0.52, ge=0.05, le=0.99)


@router.get("/models/thresholds")
def get_thresholds():
    return {"confidence": settings.CONFIDENCE_THRESHOLD, "weapon_confidence": settings.WEAPON_CONFIDENCE_THRESHOLD, "custom_confidence": settings.CUSTOM_CONFIDENCE_THRESHOLD}


@router.put("/models/thresholds", dependencies=[Depends(require_admin)])
def set_thresholds(payload: DetectionThresholds, db: Session = Depends(get_db)):
    settings.CONFIDENCE_THRESHOLD = payload.confidence
    settings.WEAPON_CONFIDENCE_THRESHOLD = payload.weapon_confidence
    settings.CUSTOM_CONFIDENCE_THRESHOLD = payload.custom_confidence
    db.merge(AppSetting(key="detection_thresholds", value=payload.model_dump_json()))
    db.commit()
    return payload


@router.post("/models/select", dependencies=[Depends(require_admin)])
def select_model(payload: ModelSelection, db: Session = Depends(get_db)):
    entry = MODEL_CATALOG.get(payload.model_id)
    if not entry:
        raise HTTPException(status_code=422, detail="Выберите модель из каталога YOLOv8 / YOLO11")
    if not MODEL_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Уже выполняется загрузка модели")
    try:
        target = PROJECT_ROOT / "ml" / "models" / entry["filename"]
        if not target.is_file() and not payload.allow_download:
            raise HTTPException(status_code=409, detail="Веса не установлены. Подтвердите загрузку официальных весов.")
        try:
            if not target.is_file():
                download_official_weights(target)
            detector.select_base_model(target)
        except Exception as exc:
            raise HTTPException(status_code=503, detail="Не удалось загрузить/проверить модель. Прежняя модель остаётся активной.") from exc
        db.merge(AppSetting(key="base_model", value=entry["filename"]))
        db.commit()
        return model_catalog()
    finally:
        MODEL_LOCK.release()
