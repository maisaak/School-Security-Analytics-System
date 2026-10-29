from __future__ import annotations

from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class CameraCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(..., min_length=2, max_length=120, examples=["Камера №4 — Спортзал"])
    location: str = Field(default="Периметр школы", max_length=160)
    rtsp_url: str = Field(..., min_length=3, max_length=512, examples=["sim://hallway"])


class CameraOut(BaseModel):
    id: int
    name: str
    location: str
    rtsp_url: str
    is_active: bool
    created_at: datetime
    online: bool = False
    fps: float = 0.0
    latency_ms: float = 0.0
    person_count: int = 0
    active_threats: list[str] = []
    is_simulated: bool = False
    last_error: str | None = None


class SimulateRequest(BaseModel):
    scenario: Literal["suspicious_bag", "dog", "weapon", "person_with_bag"]


class ViolationOut(BaseModel):
    id: int
    camera_id: int
    camera_name: str
    camera_location: str
    violation_type: str
    confidence: float
    bbox: list[int]
    image_path: str
    video_url: str
    is_acknowledged: bool
    review_status: str = "new"
    review_comment: str = ""
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    detected_at: datetime


class ViolationReview(BaseModel):
    status: Literal["new", "in_review", "confirmed", "false_alarm", "closed"]
    comment: str = Field(default="", max_length=2000)


class RetrainRequest(BaseModel):
    epochs: int = Field(default=6, ge=1, le=100)
    dataset_yaml: str = Field(default="ml/datasets/school_security.yaml")


class RetrainJobOut(BaseModel):
    id: int
    status: str
    epochs: int
    current_epoch: int
    progress_pct: int
    dataset_yaml: str
    metrics: dict[str, float]
    details: str
    created_at: datetime
    completed_at: datetime | None = None
