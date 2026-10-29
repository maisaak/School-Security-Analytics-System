from __future__ import annotations

import shutil
from fastapi import APIRouter, Depends

from app.core.config import PROJECT_ROOT, settings
from app.core.security import require_admin
from app.db.models import Camera, RetrainJob
from app.db.session import get_db
from app.models.detector import detector
from app.services.stream_manager import stream_manager

router = APIRouter(prefix="/api/system", dependencies=[Depends(require_admin)], tags=["system"])


@router.get("/diagnostics")
def diagnostics(db=Depends(get_db)):
    cameras = []
    for camera in db.query(Camera).filter(Camera.rtsp_url != "lab://uploads").order_by(Camera.id).all():
        telemetry = stream_manager.get_telemetry(camera.id)
        cameras.append({"id": camera.id, "name": camera.name, "active": camera.is_active, "online": telemetry["online"], "fps": telemetry["fps"], "latency_ms": telemetry["latency_ms"], "last_error": telemetry["last_error"]})
    usage = shutil.disk_usage(PROJECT_ROOT)
    running_jobs = db.query(RetrainJob).filter(RetrainJob.status.in_(["queued", "running"])).count()
    return {
        "status": "ok" if all(c["online"] for c in cameras if c["active"]) else "attention",
        "api": "ok",
        "database": "ok",
        "model": {"base": detector.base_weights_name, "active": detector.active_weights_name, "path_exists": settings.YOLO_COCO_MODEL_PATH.is_file()},
        "disk": {"free_bytes": usage.free, "total_bytes": usage.total, "free_percent": round(usage.free / usage.total * 100, 1)},
        "training": {"running_jobs": running_jobs, "local_enabled": settings.ENABLE_LOCAL_TRAINING},
        "cameras": cameras,
    }
