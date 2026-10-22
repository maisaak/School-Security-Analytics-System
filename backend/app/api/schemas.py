from __future__ import annotations

from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


RoleLiteral = Literal["admin", "director", "guard"]


# ─── Аутентификация и пользователи ───────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class DemoLoginRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)


class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    role: str
    is_active: bool
    is_demo: bool
    permissions: list[str] = []
    created_at: datetime
    last_login_at: datetime | None = None


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9._-]+$")
    password: str = Field(..., min_length=6, max_length=128)
    full_name: str = Field(default="", max_length=160)
    role: RoleLiteral


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=160)
    role: RoleLiteral | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=6, max_length=128)


class AuthSessionOut(BaseModel):
    user: UserOut
    expires_at: datetime
    token_type: str = "cookie"
    access_token: str | None = None


class DemoAccountOut(BaseModel):
    username: str
    role: str
    role_label: str
    full_name: str
    description: str
    password_hint: str


# ─── Камеры ──────────────────────────────────────────────────────────────────

class CameraCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120, examples=["Камера №4 — Спортзал"])
    location: str = Field(default="Периметр школы", max_length=160)
    rtsp_url: str = Field(..., min_length=3, max_length=512, examples=["sim://hallway"])


class BagTrackOut(BaseModel):
    track_id: str
    state: Literal["attended", "holding", "unattended"]
    bbox: list[int]
    confidence: float
    dwell_seconds: float
    hits: int
    observed: bool


class CameraOut(BaseModel):
    id: int
    name: str
    location: str
    rtsp_url: str  # ВСЕГДА маскированный (без логина/пароля)
    has_credentials: bool = False
    is_active: bool
    created_at: datetime
    online: bool = False
    fps: float = 0.0
    latency_ms: float = 0.0
    person_count: int = 0
    active_threats: list[str] = []
    bag_tracking: list[BagTrackOut] = []
    is_simulated: bool = False


class SimulateRequest(BaseModel):
    scenario: Literal["suspicious_bag", "dog", "weapon", "person_with_bag"]


# ─── Нарушения ───────────────────────────────────────────────────────────────

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
    detected_at: datetime
    track_id: str | None = None
    dwell_seconds: float | None = None
    acknowledged_by: str | None = None
    acknowledged_at: datetime | None = None


# ─── Дообучение, реестр версий и Validation Gate ─────────────────────────────

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
    requested_by: str | None = None
    baseline_map50: float | None = None
    final_map50: float | None = None
    validation_passed: bool | None = None
    version_id: int | None = None


class ModelVersionOut(BaseModel):
    id: int
    label: str
    weights_path: str
    metrics: dict[str, float]
    map50: float | None = None
    map50_95: float | None = None
    baseline_map50: float | None = None
    delta_map50: float | None = None
    status: str
    validation_passed: bool | None = None
    validation_notes: str = ""
    job_id: int | None = None
    source: str
    size_bytes: int = 0
    sha256: str = ""
    created_by: str = "system"
    created_at: datetime
    activated_at: datetime | None = None
    is_current: bool = False


class RollbackRequest(BaseModel):
    reason: str = Field(default="Ручной откат администратором", max_length=240)
    force: bool = False


# ─── Аудит ───────────────────────────────────────────────────────────────────

class AuditLogOut(BaseModel):
    id: int
    created_at: datetime
    actor_username: str | None = None
    actor_role: str | None = None
    action: str
    entity_type: str | None = None
    entity_id: str | None = None
    outcome: str
    ip_address: str | None = None
    user_agent: str | None = None
    detail: str = ""


class AuditPageOut(BaseModel):
    total: int
    items: list[AuditLogOut]
    actions: list[str]
