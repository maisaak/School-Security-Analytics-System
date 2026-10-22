from __future__ import annotations

import sys
import threading
from datetime import datetime, timezone

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.api.schemas import (
    ModelCatalogOut,
    ModelVersionOut,
    RetrainJobOut,
    RetrainRequest,
    RollbackRequest,
)
from app.api.serializers import serialize_job, serialize_version
from app.core.auth import require_permissions
from app.core.config import PROJECT_ROOT, settings
from app.core.permissions import Permission
from app.core.security import read_upload_limited, validate_dataset_yaml
from app.db.models import Camera, ModelVersion, RetrainJob, User
from app.db.session import get_db
from app.models.detector import detector
from app.services.audit import record_audit
from app.services.hls import playlist_ready
from app.services.model_registry import activate_version, current_production
from app.services.tasks import celery_app, execute_retrain_job, retrain_model_task

router = APIRouter(prefix="/api/models", tags=["YOLOv8: дообучение и реестр версий"])
RETRAIN_LOCK = threading.Lock()


@router.get("/catalog", response_model=ModelCatalogOut)
def model_catalog(
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.MODELS_VIEW)),
):
    """
    Каталог YOLO-моделей для админ-панели.

    Отдаёт три слоя:
      1. components — реальные веса ансамбля (COCO, оружие, школьная модель):
         файл, классы, порог уверенности, размер, статус загрузки;
      2. profiles — готовые профили детекции и сколько камер на каждом;
      3. versions — реестр версий весов с mAP@50, чтобы выбрать боевую модель.
    """
    camera_counts: dict[str, int] = {}
    for cam in db.query(Camera).all():
        key = cam.detector_profile or settings.DETECTOR_PROFILE
        camera_counts[key] = camera_counts.get(key, 0) + 1

    catalog = detector.describe_catalog(camera_counts)
    production = current_production(db)
    versions = db.query(ModelVersion).order_by(ModelVersion.id.desc()).limit(30).all()

    return ModelCatalogOut(
        components=catalog["components"],
        profiles=catalog["profiles"],
        versions=[serialize_version(v, production.id if production else None) for v in versions],
        production=serialize_version(production, production.id) if production else None,
        active_weights=catalog["active_weights"],
        reloaded_at=catalog["reloaded_at"],
        hls={
            "enabled": settings.HLS_ENABLED,
            "segment_sec": settings.HLS_SEGMENT_SEC,
            "max_segments": settings.HLS_MAX_SEGMENTS,
            "ready_cameras": [
                cam.id for cam in db.query(Camera).all() if playlist_ready(cam.id)
            ],
        },
    )


@router.get("/dataset")
def get_dataset_info(_: User = Depends(require_permissions(Permission.MODELS_VIEW))):
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))
    from ml.datasets.generate_dataset import ensure_custom_dataset

    return ensure_custom_dataset(PROJECT_ROOT)


@router.post("/dataset/upload")
async def upload_training_sample(
    request: Request,
    file: UploadFile = File(...),
    violation_type: str = Form(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.MODELS_TRAIN)),
):
    if violation_type not in {"dog", "weapon", "suspicious_bag"}:
        raise HTTPException(status_code=400, detail="Некорректный класс объекта")

    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))
    from ml.datasets.generate_dataset import CLASS_MAP, ensure_custom_dataset, extract_foreground_rgba

    ensure_custom_dataset(PROJECT_ROOT)

    content = await read_upload_limited(file, max_bytes=settings.MAX_UPLOAD_IMAGE_MB * 1024 * 1024)
    arr = np.frombuffer(content, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Не удалось прочитать изображение")

    img_resized = cv2.resize(img, (960, 540), interpolation=cv2.INTER_AREA)
    an = detector.detect_frame(img_resized)
    bbox = None
    for v in an["violations"]:
        if v["type"] == violation_type:
            bbox = v["bbox"]
            break
    if bbox is None:
        rgba = extract_foreground_rgba(img_resized)
        ys, xs = np.where(rgba[:, :, 3] > 128)
        if len(xs) > 50 and len(ys) > 50:
            bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
        else:
            bbox = [144, 81, 816, 459]

    x1, y1, x2, y2 = bbox
    cx = ((x1 + x2) / 2.0) / 960.0
    cy = ((y1 + y2) / 2.0) / 540.0
    bw = max(0.05, (x2 - x1) / 960.0)
    bh = max(0.05, (y2 - y1) / 540.0)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    ds_root = PROJECT_ROOT / "ml" / "datasets" / "custom"
    img_out = ds_root / "images" / "train" / f"user_{violation_type}_{stamp}.jpg"
    lbl_out = ds_root / "labels" / "train" / f"user_{violation_type}_{stamp}.txt"

    cv2.imwrite(str(img_out), img_resized, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    lbl_out.write_text(f"{CLASS_MAP[violation_type]} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}\n", encoding="utf-8")

    record_audit(
        db,
        action="dataset.sample_upload",
        request=request,
        user=user,
        entity_type="dataset",
        entity_id=img_out.name,
        detail={"violation_type": violation_type, "filename": file.filename, "bbox": bbox},
    )

    return {
        "status": "added",
        "filename": img_out.name,
        "violation_type": violation_type,
        "dataset": get_dataset_info(user),
    }


@router.get("/jobs", response_model=list[RetrainJobOut])
def list_retrain_jobs(
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.MODELS_VIEW)),
):
    jobs = db.query(RetrainJob).order_by(RetrainJob.id.desc()).limit(25).all()
    return [serialize_job(j) for j in jobs]


@router.post("/retrain", response_model=RetrainJobOut)
def retrain_model(
    payload: RetrainRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.MODELS_TRAIN)),
):
    safe_yaml = validate_dataset_yaml(payload.dataset_yaml)
    rel_yaml = safe_yaml.relative_to(PROJECT_ROOT).as_posix()

    with RETRAIN_LOCK:
        active = db.query(RetrainJob).filter(RetrainJob.status.in_(["queued", "running"])).first()
        if active:
            raise HTTPException(status_code=409, detail=f"Задача дообучения #{active.id} уже выполняется")

        production = current_production(db)
        job = RetrainJob(
            status="queued",
            epochs=payload.epochs,
            current_epoch=0,
            dataset_yaml=rel_yaml,
            details="Поставлена в очередь обучения",
            requested_by=user.username,
            baseline_map50=production.map50 if production else None,
        )
        db.add(job)
        db.commit()
        db.refresh(job)

    record_audit(
        db,
        action="model.retrain.start",
        request=request,
        user=user,
        entity_type="retrain_job",
        entity_id=job.id,
        detail={
            "epochs": payload.epochs,
            "dataset_yaml": rel_yaml,
            "baseline_map50": job.baseline_map50,
            "tolerance": settings.MAP50_ROLLBACK_TOLERANCE,
        },
    )

    dispatched_celery = False
    try:
        import redis as redis_lib

        r_client = redis_lib.from_url(settings.REDIS_URL, socket_connect_timeout=0.35, socket_timeout=0.35)
        if r_client.ping():
            workers = celery_app.control.inspect(timeout=0.4).active()
            if workers:
                retrain_model_task.delay(job.id, payload.epochs, rel_yaml)
                dispatched_celery = True
    except Exception:
        dispatched_celery = False

    if not dispatched_celery:
        threading.Thread(
            target=execute_retrain_job,
            args=(job.id, payload.epochs, rel_yaml),
            daemon=True,
        ).start()

    return serialize_job(db.query(RetrainJob).filter(RetrainJob.id == job.id).first())


@router.get("/versions", response_model=list[ModelVersionOut])
def list_model_versions(
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.MODELS_VIEW)),
):
    versions = db.query(ModelVersion).order_by(ModelVersion.id.desc()).limit(50).all()
    production = current_production(db)
    return [serialize_version(v, production.id if production else None) for v in versions]


@router.post("/versions/{version_id}/rollback", response_model=ModelVersionOut)
def rollback_model_version(
    version_id: int,
    payload: RollbackRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.MODELS_ROLLBACK)),
):
    """Откат на выбранную версию весов из реестра (например, если новая модель деградировала)."""
    version = db.query(ModelVersion).filter(ModelVersion.id == version_id).first()
    if not version:
        raise HTTPException(status_code=404, detail="Версия весов не найдена")
    if version.status == "production":
        raise HTTPException(status_code=409, detail="Эта версия уже является боевой")
    if version.validation_passed is False and not payload.force:
        raise HTTPException(
            status_code=409,
            detail=(
                "Версия отклонена Validation Gate (mAP@50 ниже базового). "
                "Для принудительной активации передайте force=true."
            ),
        )

    previous = current_production(db)
    try:
        version = activate_version(
            db,
            version,
            reason=f"Откат администратором {user.username}: {payload.reason}",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=410, detail=str(exc)) from exc

    record_audit(
        db,
        action="model.rollback",
        request=request,
        user=user,
        entity_type="model_version",
        entity_id=version.id,
        detail={
            "reason": payload.reason,
            "forced": payload.force,
            "restored_version": version.label,
            "previous_version": previous.label if previous else None,
            "map50": version.map50,
            "weights_path": version.weights_path,
        },
    )
    return serialize_version(version, version.id)


@router.get("/gate")
def validation_gate_info(
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.MODELS_VIEW)),
):
    production = current_production(db)
    rejected = (
        db.query(ModelVersion)
        .filter(ModelVersion.validation_passed.is_(False))
        .order_by(ModelVersion.id.desc())
        .limit(5)
        .all()
    )
    return {
        "tolerance": settings.MAP50_ROLLBACK_TOLERANCE,
        "min_absolute_map50": settings.MAP50_MIN_ABSOLUTE,
        "production": serialize_version(production, production.id if production else None) if production else None,
        "recent_rejections": [
            {
                "id": v.id,
                "label": v.label,
                "map50": v.map50,
                "baseline_map50": v.baseline_map50,
                "notes": v.validation_notes,
                "created_at": v.created_at,
            }
            for v in rejected
        ],
        "active_weights": detector.active_weights_name,
        "active_map50": production.map50 if production else None,
    }
