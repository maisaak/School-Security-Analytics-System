from __future__ import annotations

from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator


RoleLiteral = Literal["admin", "director", "guard"]


# ─── Аутентификация и пользователи ───────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)
    # Код приложения-аутентификатора, если у пользователя включена 2FA
    totp_code: str | None = Field(default=None, max_length=16)


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
    totp_enabled: bool = False
    camera_scope: list[int] = []


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


class CameraDetectorUpdate(BaseModel):
    profile: str = Field(..., examples=["ensemble", "custom", "coco", "weapon"])


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
    # Источник и способ воспроизведения
    source_kind: str = "simulated"  # simulated | rtsp | http | file
    detector_profile: str = "ensemble"
    stream_mode: str = "mjpeg"  # hls | mjpeg
    hls_ready: bool = False
    # v3: аналитическая политика камеры
    confidence_threshold: float | None = None
    schedule: dict = {}
    ab_profile: str | None = None
    ab_share_pct: int = 0
    zones_count: int = 0
    turnstile: str | None = None


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
    is_false_alarm: bool = False
    acknowledged_latency_sec: float | None = None
    zone_name: str | None = None
    model_variant: str | None = None
    notes: str = ""


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
    architecture: str = "yolov8"
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


class DetectorComponentOut(BaseModel):
    role: str
    label: str
    filename: str
    exists: bool
    loaded: bool
    size_bytes: int = 0
    classes: list[str] = []
    confidence_threshold: float = 0.5
    imgsz: int = 640
    architecture: str = "YOLOv8"


class DetectorProfileOut(BaseModel):
    key: str
    label: str
    description: str
    components: list[str]
    accent: str = "emerald"
    cameras: int = 0


class ModelCatalogOut(BaseModel):
    components: list[DetectorComponentOut]
    profiles: list[DetectorProfileOut]
    supported_architectures: list[SupportedArchitectureOut] = []
    versions: list[ModelVersionOut] = []
    production: ModelVersionOut | None = None
    active_weights: str = ""
    reloaded_at: str = ""
    hls: dict = {}


# ─── Загрузка собственных весов YOLO ─────────────────────────────────────────

class ModelUploadResult(BaseModel):
    version: ModelVersionOut
    inspection: dict
    activated: bool = False
    gate_passed: bool | None = None
    gate_notes: str = ""
    message: str = ""


class SupportedArchitectureOut(BaseModel):
    key: str
    label: str


# ─── Персональные настройки интерфейса ───────────────────────────────────────

KPI_KEYS = ("cameras", "violations", "critical", "dwell", "latency", "confidence")


class PreferencesIn(BaseModel):
    """Персональные настройки интерфейса: оформление и набор KPI на дашборде."""

    theme: Literal["dark", "light", "contrast"] = "dark"
    accent: Literal["emerald", "indigo", "sky", "amber", "rose"] = "emerald"
    kpis: list[str] = Field(default_factory=lambda: ["cameras", "violations", "dwell", "latency"])
    compact_tables: bool = False
    show_timeline: bool = True
    mobile_bottom_nav: bool = True
    # v3: уведомления в интерфейсе
    sound_enabled: bool = True
    toasts_enabled: bool = True

    @field_validator("kpis")
    @classmethod
    def _validate_kpis(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for key in value:
            if key not in KPI_KEYS:
                raise ValueError(
                    "Неизвестный KPI: " + key + ". Допустимые: " + ", ".join(KPI_KEYS)
                )
            if key not in cleaned:
                cleaned.append(key)
        if not cleaned:
            raise ValueError("Выберите хотя бы один KPI для дашборда")
        return cleaned


class PreferencesOut(PreferencesIn):
    updated_at: str | None = None


# ─── v3: зоны, политика камеры, эксплуатация, школа ──────────────────────────

class ZoneIn(BaseModel):
    id: int | None = None
    name: str = Field(default="Зона", max_length=120)
    kind: Literal["include", "exclude"] = "include"
    color: str = Field(default="#10b981", max_length=16)
    points: list[list[float]] = Field(default_factory=list)


class ZonesPayload(BaseModel):
    zones: list[ZoneIn] = Field(default_factory=list)


class CameraPolicyIn(BaseModel):
    confidence_threshold: float | None = Field(default=None, ge=0.05, le=0.99)
    schedule: dict | None = None
    ab_profile: str | None = None
    ab_share_pct: int | None = Field(default=None, ge=0, le=100)
    turnstile: str | None = Field(default=None, max_length=64)


class FalseAlarmIn(BaseModel):
    is_false_alarm: bool
    notes: str | None = Field(default=None, max_length=500)


class SnapshotOptions(BaseModel):
    watermark: bool = True
    blur_faces: bool = False


class CameraScopeIn(BaseModel):
    camera_ids: list[int] = Field(default_factory=list)


class TotpCodeIn(BaseModel):
    code: str = Field(..., min_length=6, max_length=16)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=6, max_length=128)


class PasswordOnlyIn(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)


class NotificationSettingsIn(BaseModel):
    enabled: bool | None = None
    bot_token: str | None = Field(default=None, max_length=200)
    director_chat_id: str | None = Field(default=None, max_length=64)
    guard_chat_id: str | None = Field(default=None, max_length=64)
    notify_weapon: bool | None = None
    notify_bag: bool | None = None
    notify_dog: bool | None = None
    notify_offline: bool | None = None
    notify_emergency: bool | None = None


class RetentionPolicyIn(BaseModel):
    days: int | None = Field(default=None, ge=1, le=3650)
    max_gb: float | None = Field(default=None, ge=0.1, le=2048)
    auto_clean: bool | None = None


class BackupRestoreIn(BaseModel):
    filename: str = Field(..., max_length=200)
    confirm: str = Field(..., max_length=32)


class EmergencyIn(BaseModel):
    active: bool
    reason: str = Field(default="", max_length=240)


class VisitorPassIn(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=160)
    organization: str = Field(default="", max_length=160)
    purpose: str = Field(default="", max_length=240)
    host: str = Field(default="", max_length=160)
    phone: str = Field(default="", max_length=32)
    valid_hours: int = Field(default=4, ge=1, le=72)
    notes: str = Field(default="", max_length=500)


class AccessEventIn(BaseModel):
    person_name: str = Field(..., min_length=2, max_length=160)
    person_kind: Literal["student", "staff", "teacher", "visitor"] = "visitor"
    class_name: str = Field(default="", max_length=32)
    turnstile: str = Field(default="Главный вход", max_length=64)
    direction: Literal["in", "out"] = "in"
    card_id: str = Field(default="", max_length=64)
