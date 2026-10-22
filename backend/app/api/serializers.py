from __future__ import annotations

import json
from urllib.parse import urlparse

from app.api.schemas import (
    AuditLogOut,
    CameraOut,
    ModelVersionOut,
    RetrainJobOut,
    UserOut,
    ViolationOut,
)
from app.core.permissions import role_permissions
from app.core.security import mask_stream_url
from app.db.models import AuditLog, Camera, ModelVersion, RetrainJob, User, Violation
from app.services.stream_manager import stream_manager


def has_credentials(raw_url: str | None) -> bool:
    if not raw_url:
        return False
    try:
        return "@" in (urlparse(raw_url).netloc or "")
    except ValueError:
        return False


def source_kind(raw_url: str | None) -> str:
    """Тип источника камеры: виртуальный поток, RTSP, HTTP(S) или локальный файл."""
    url = (raw_url or "").strip().lower()
    if url.startswith(("sim://", "demo://")):
        return "simulated"
    if url.startswith(("rtsp://", "rtsps://")):
        return "rtsp"
    if url.startswith(("http://", "https://")):
        return "http"
    return "file"


def serialize_camera(cam: Camera) -> CameraOut:
    tel = dict(stream_manager.get_telemetry(cam.id))
    profile = tel.pop("detector_profile", None) or getattr(cam, "detector_profile", "ensemble")
    return CameraOut(
        id=cam.id,
        name=cam.name,
        location=cam.location,
        # КРИТИЧНО: наружу отдаём только маскированный URL, логин/пароль никогда не покидают сервер
        rtsp_url=mask_stream_url(cam.rtsp_url),
        has_credentials=has_credentials(cam.rtsp_url),
        is_active=cam.is_active,
        created_at=cam.created_at,
        source_kind=source_kind(cam.rtsp_url),
        detector_profile=profile,
        **tel,
    )


def serialize_violation(v: Violation) -> ViolationOut:
    try:
        bbox = json.loads(v.bbox_json or "[]")
    except Exception:
        bbox = []
    return ViolationOut(
        id=v.id,
        camera_id=v.camera_id,
        camera_name=v.camera.name if v.camera else f"Камера #{v.camera_id}",
        camera_location=v.camera.location if v.camera else "Архив",
        violation_type=v.violation_type,
        confidence=v.confidence,
        bbox=bbox,
        image_path=v.image_path,
        video_url=f"/api/violations/{v.id}/video",
        is_acknowledged=v.is_acknowledged,
        detected_at=v.detected_at,
        track_id=v.track_id,
        dwell_seconds=v.dwell_seconds,
        acknowledged_by=v.acknowledged_by,
        acknowledged_at=v.acknowledged_at,
    )


def serialize_job(job: RetrainJob) -> RetrainJobOut:
    try:
        metrics = {k: float(v) for k, v in json.loads(job.metrics_json or "{}").items()}
    except Exception:
        metrics = {}
    pct = 100 if job.status in {"completed", "rejected"} else int(
        round((job.current_epoch / max(1, job.epochs)) * 100)
    )
    return RetrainJobOut(
        id=job.id,
        status=job.status,
        epochs=job.epochs,
        current_epoch=job.current_epoch,
        progress_pct=min(100, max(0, pct)),
        dataset_yaml=job.dataset_yaml,
        metrics=metrics,
        details=job.details or "",
        created_at=job.created_at,
        completed_at=job.completed_at,
        requested_by=job.requested_by,
        baseline_map50=job.baseline_map50,
        final_map50=job.final_map50,
        validation_passed=job.validation_passed,
        version_id=job.version_id,
    )


def serialize_version(version: ModelVersion, current_id: int | None = None) -> ModelVersionOut:
    try:
        metrics = {k: float(v) for k, v in json.loads(version.metrics_json or "{}").items()}
    except Exception:
        metrics = {}
    delta = None
    if version.map50 is not None and version.baseline_map50 is not None:
        delta = round(version.map50 - version.baseline_map50, 4)
    return ModelVersionOut(
        id=version.id,
        label=version.label,
        weights_path=version.weights_path,
        metrics=metrics,
        map50=version.map50,
        map50_95=version.map50_95,
        baseline_map50=version.baseline_map50,
        delta_map50=delta,
        status=version.status,
        validation_passed=version.validation_passed,
        validation_notes=version.validation_notes or "",
        job_id=version.job_id,
        source=version.source,
        size_bytes=version.size_bytes or 0,
        sha256=version.sha256 or "",
        created_by=version.created_by or "system",
        created_at=version.created_at,
        activated_at=version.activated_at,
        is_current=(current_id is not None and version.id == current_id) or version.status == "production",
    )


def serialize_user(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        is_demo=user.is_demo,
        permissions=role_permissions(user.role),
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


def serialize_audit(entry: AuditLog) -> AuditLogOut:
    return AuditLogOut(
        id=entry.id,
        created_at=entry.created_at,
        actor_username=entry.actor_username,
        actor_role=entry.actor_role,
        action=entry.action,
        entity_type=entry.entity_type,
        entity_id=entry.entity_id,
        outcome=entry.outcome,
        ip_address=entry.ip_address,
        user_agent=entry.user_agent,
        detail=entry.detail or "",
    )
