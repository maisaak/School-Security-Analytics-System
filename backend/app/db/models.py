from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.db.session import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Camera(Base):
    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    location = Column(String(160), default="Главный вход")
    rtsp_url = Column(String(512), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
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

    camera = relationship("Camera", back_populates="violations")


class RetrainJob(Base):
    __tablename__ = "retrain_jobs"

    id = Column(Integer, primary_key=True, index=True)
    status = Column(String(32), default="queued", nullable=False)  # queued | running | completed | failed
    epochs = Column(Integer, default=8, nullable=False)
    current_epoch = Column(Integer, default=0, nullable=False)
    dataset_yaml = Column(String(512), default="ml/datasets/school_security.yaml")
    metrics_json = Column(Text, default="{}")
    details = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
