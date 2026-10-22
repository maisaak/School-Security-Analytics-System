from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.db.session import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, index=True, nullable=False)
    full_name = Column(String(160), nullable=False, default="")
    role = Column(String(24), nullable=False, default="guard", index=True)  # admin | director | guard
    password_hash = Column(String(256), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_demo = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_login_at = Column(DateTime(timezone=True), nullable=True)


class Camera(Base):
    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    location = Column(String(160), default="Главный вход")
    rtsp_url = Column(String(512), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    # Профиль детекции YOLO, выбранный администратором (см. core/detector_profiles.py)
    detector_profile = Column(String(32), default="ensemble", nullable=False, server_default="ensemble")
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    violations = relationship(
        "Violation",
        back_populates="camera",
        cascade="all, delete-orphan",
    )


class Violation(Base):
    __tablename__ = "violations"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False, index=True)
    violation_type = Column(String(64), index=True, nullable=False)  # weapon | suspicious_bag | dog
    confidence = Column(Float, nullable=False)
    bbox_json = Column(String(128), default="[]")
    image_path = Column(String(512), nullable=False)
    video_path = Column(String(512), nullable=True)
    is_acknowledged = Column(Boolean, default=False, nullable=False)
    detected_at = Column(DateTime(timezone=True), default=utcnow, index=True, nullable=False)

    # v2: сквозной трекинг и таймер выдержки бесхозного предмета
    track_id = Column(String(48), nullable=True, index=True)
    dwell_seconds = Column(Float, nullable=True)
    acknowledged_by = Column(String(64), nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)

    camera = relationship("Camera", back_populates="violations")


class RetrainJob(Base):
    __tablename__ = "retrain_jobs"

    id = Column(Integer, primary_key=True, index=True)
    status = Column(String(32), default="queued", nullable=False)  # queued | running | completed | failed | rejected
    epochs = Column(Integer, default=8, nullable=False)
    current_epoch = Column(Integer, default=0, nullable=False)
    dataset_yaml = Column(String(512), default="ml/datasets/school_security.yaml")
    metrics_json = Column(Text, default="{}")
    details = Column(Text, default="")
    requested_by = Column(String(64), nullable=True)

    # v2: Validation Gate
    baseline_map50 = Column(Float, nullable=True)
    final_map50 = Column(Float, nullable=True)
    validation_passed = Column(Boolean, nullable=True)
    version_id = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)


class ModelVersion(Base):
    """Реестр версий весов YOLOv8 с результатами Validation Gate и поддержкой отката."""

    __tablename__ = "model_versions"

    id = Column(Integer, primary_key=True, index=True)
    label = Column(String(80), nullable=False)
    weights_path = Column(String(512), nullable=False)  # путь относительно корня репозитория
    metrics_json = Column(Text, default="{}")
    map50 = Column(Float, nullable=True)
    map50_95 = Column(Float, nullable=True)
    baseline_map50 = Column(Float, nullable=True)
    status = Column(String(24), default="candidate", nullable=False, index=True)
    # candidate | production | rejected | archived
    validation_passed = Column(Boolean, nullable=True)
    validation_notes = Column(Text, default="")
    job_id = Column(Integer, nullable=True, index=True)
    source = Column(String(32), default="retrain", nullable=False)  # baseline | retrain | rollback
    size_bytes = Column(Integer, default=0)
    sha256 = Column(String(64), default="")
    created_by = Column(String(64), default="system")
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    activated_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (UniqueConstraint("weights_path", name="uq_model_version_weights_path"),)


class AuditLog(Base):
    """Полный журнал аудита действий пользователей и системы."""

    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    actor_id = Column(Integer, nullable=True, index=True)
    actor_username = Column(String(64), nullable=True, index=True)
    actor_role = Column(String(24), nullable=True)
    action = Column(String(80), nullable=False, index=True)
    entity_type = Column(String(48), nullable=True, index=True)
    entity_id = Column(String(64), nullable=True)
    outcome = Column(String(16), default="success", nullable=False)  # success | denied | failure
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(256), nullable=True)
    detail = Column(Text, default="")

    __table_args__ = (Index("ix_audit_action_created", "action", "created_at"),)
