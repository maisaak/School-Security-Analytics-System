from __future__ import annotations

import asyncio
import json
import shutil
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import cv2
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.api.schemas import CameraCreate, CameraOut, RetrainJobOut, RetrainRequest, SimulateRequest, ViolationOut
from app.core.config import PROJECT_ROOT, settings
from app.core.security import read_upload_sync, redact_stream_url, safe_delete_media_file, validate_dataset_yaml, validate_stream_source, verify_api_key, require_admin
from app.db.models import Camera, RetrainJob, Violation
from app.db.session import get_db
from app.models.detector import detector
from app.services.media_analysis import analyze_media, decode_image
from app.services.stream_manager import stream_manager
from app.services.tasks import celery_app, execute_retrain_job, retrain_model_task
from ml.datasets.generate_dataset import CLASS_MAP, get_dataset_stats
from ml.dataset_validation import validate_dataset

router = APIRouter(prefix="/api", dependencies=[Depends(verify_api_key)])
RETRAIN_LOCK = threading.Lock()
CAMERA_LOCK = threading.Lock()
DATASET_LOCK = threading.Lock()


def _serialize_camera(cam: Camera) -> CameraOut:
    return CameraOut(id=cam.id, name=cam.name, location=cam.location, rtsp_url=redact_stream_url(cam.rtsp_url), is_active=cam.is_active, created_at=cam.created_at, **stream_manager.get_telemetry(cam.id))


def _serialize_violation(v: Violation) -> ViolationOut:
    return ViolationOut(id=v.id, camera_id=v.camera_id, camera_name=v.camera.name if v.camera else "Архив", camera_location=v.camera.location if v.camera else "Архив", violation_type=v.violation_type, confidence=v.confidence, bbox=json.loads(v.bbox_json or "[]"), image_path=v.image_path, video_url=f"/api/violations/{v.id}/video" if v.video_path else "", is_acknowledged=v.is_acknowledged, detected_at=v.detected_at.replace(tzinfo=timezone.utc) if v.detected_at.tzinfo is None else v.detected_at)


def _serialize_job(job: RetrainJob) -> RetrainJobOut:
    done = job.status in {"completed", "ready", "active"}
    return RetrainJobOut(id=job.id, status=job.status, epochs=job.epochs, current_epoch=job.current_epoch, progress_pct=100 if done else min(100, round(job.current_epoch / max(1, job.epochs) * 100)), dataset_yaml=job.dataset_yaml, metrics=json.loads(job.metrics_json or "{}"), details=job.details or "", created_at=job.created_at, completed_at=job.completed_at)


def _delete_incidents(rows: list[Violation], db: Session) -> None:
    paths = {path for row in rows for path in (row.image_path, row.video_path) if path}
    for row in rows:
        db.delete(row)
    db.flush()
    # Several detections may share one upload/clip. Do not break remaining records.
    unused = [p for p in paths if not db.query(Violation.id).filter((Violation.image_path == p) | (Violation.video_path == p)).first()]
    db.commit()
    for path in unused:
        safe_delete_media_file(path)


@router.post("/cameras", response_model=CameraOut, status_code=201)
def add_camera(payload: CameraCreate, db: Session = Depends(get_db)):
    source = validate_stream_source(payload.rtsp_url)
    with CAMERA_LOCK:
        if db.query(Camera).filter(Camera.rtsp_url != "lab://uploads").count() >= settings.MAX_CAMERAS:
            raise HTTPException(status_code=409, detail="Достигнут лимит камер")
        cam = Camera(name=payload.name, location=payload.location or "Периметр школы", rtsp_url=source, is_active=True)
        db.add(cam)
        db.commit()
        db.refresh(cam)
        stream_manager.start_camera(cam.id, cam.name, cam.rtsp_url)
    return _serialize_camera(cam)


@router.get("/cameras", response_model=list[CameraOut])
def list_cameras(db: Session = Depends(get_db)):
    return [_serialize_camera(c) for c in db.query(Camera).filter(Camera.rtsp_url != "lab://uploads").order_by(Camera.id).all()]


@router.post("/cameras/{camera_id}/toggle", response_model=CameraOut)
def toggle_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.get(Camera, camera_id)
    if not cam or cam.rtsp_url == "lab://uploads":
        raise HTTPException(status_code=404, detail="Камера не найдена")
    cam.is_active = not cam.is_active
    db.commit()
    stream_manager.set_paused(cam.id, not cam.is_active)
    return _serialize_camera(cam)


@router.post("/cameras/{camera_id}/simulate")
def simulate_camera_event(camera_id: int, payload: SimulateRequest):
    if not stream_manager.trigger_scenario(camera_id, payload.scenario):
        raise HTTPException(status_code=400, detail="Симуляция доступна только для sim:// камер")
    return {"status": "triggered", "camera_id": camera_id, "scenario": payload.scenario}


@router.delete("/cameras/{camera_id}", status_code=204)
def delete_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.get(Camera, camera_id)
    if not cam or cam.rtsp_url == "lab://uploads":
        raise HTTPException(status_code=404, detail="Камера не найдена")
    stream_manager.stop_camera(camera_id)
    _delete_incidents(list(cam.violations), db)
    db.expire(cam, ["violations"])
    db.delete(cam)
    db.commit()
    return Response(status_code=204)


@router.get("/cameras/{camera_id}/snapshot")
def camera_snapshot(camera_id: int):
    frame = stream_manager.get_frame(camera_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Кадр ещё не готов")
    return Response(frame, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/cameras/{camera_id}/stream")
async def stream_camera(camera_id: int, request: Request):
    if not stream_manager.has_camera(camera_id):
        raise HTTPException(status_code=404, detail="Камера не найдена")

    async def frames():
        last = -1
        while not await request.is_disconnected() and stream_manager.has_camera(camera_id):
            frame, seq = stream_manager.get_frame_with_seq(camera_id)
            if frame and seq != last:
                last = seq
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
            await asyncio.sleep(1 / 15)
    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame", headers={"Cache-Control": "no-store"})


@router.get("/violations", response_model=list[ViolationOut])
def list_violations(violation_type: str | None = None, camera_id: int | None = None, unacknowledged_only: bool = False, limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    query = db.query(Violation)
    if violation_type:
        query = query.filter(Violation.violation_type == violation_type)
    if camera_id is not None:
        query = query.filter(Violation.camera_id == camera_id)
    if unacknowledged_only:
        query = query.filter(Violation.is_acknowledged.is_(False))
    return [_serialize_violation(v) for v in query.order_by(Violation.detected_at.desc(), Violation.id.desc()).offset(offset).limit(limit).all()]


@router.patch("/violations/{violation_id}/ack", response_model=ViolationOut)
def acknowledge_violation(violation_id: int, db: Session = Depends(get_db)):
    row = db.get(Violation, violation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Инцидент не найден")
    row.is_acknowledged = True  # Idempotent acknowledgement, not a toggle.
    db.commit()
    return _serialize_violation(row)


@router.delete("/violations/{violation_id}", status_code=204)
def delete_violation(violation_id: int, db: Session = Depends(get_db)):
    row = db.get(Violation, violation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Инцидент не найден")
    _delete_incidents([row], db)
    return Response(status_code=204)


@router.get("/violations/{violation_id}/video")
def get_violation_video(violation_id: int, db: Session = Depends(get_db)):
    row = db.get(Violation, violation_id)
    if not row or not row.video_path:
        raise HTTPException(status_code=404, detail="У этого инцидента нет видеозаписи")
    root = settings.MEDIA_ROOT.resolve()
    target = (root / row.video_path.removeprefix("/media/")).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(status_code=404, detail="Видеофайл отсутствует")
    return FileResponse(target, media_type="video/mp4", headers={"Cache-Control": "private, no-store"})


@router.post("/analyze/upload")
def analyze_uploaded_media(file: UploadFile = File(...), save_violation: bool = Form(False), db: Session = Depends(get_db)):
    return analyze_media(file, save_violation, db)


@router.get("/stats")
def get_dashboard_stats(db: Session = Depends(get_db)):
    cams = db.query(Camera).filter(Camera.rtsp_url != "lab://uploads").all()
    viols = db.query(Violation).order_by(Violation.detected_at.desc()).all()
    by_type = {"weapon": 0, "suspicious_bag": 0, "dog": 0}
    for v in viols:
        by_type[v.violation_type] = by_type.get(v.violation_type, 0) + 1
    now = datetime.now(timezone.utc)
    timeline = []
    for i in range(7, -1, -1):
        start, end = now - timedelta(minutes=(i + 1) * 5), now - timedelta(minutes=i * 5)
        timeline.append({"label": end.astimezone().strftime("%H:%M"), "count": sum(start <= (v.detected_at.replace(tzinfo=timezone.utc) if v.detected_at.tzinfo is None else v.detected_at) < end for v in viols)})
    latencies = [stream_manager.get_telemetry(c.id)["latency_ms"] for c in cams if c.is_active]
    return {"total_cameras": len(cams), "active_cameras": sum(stream_manager.get_telemetry(c.id)["online"] for c in cams), "total_violations": len(viols), "unacknowledged_violations": sum(not v.is_acknowledged for v in viols), "average_confidence": round(sum(v.confidence for v in viols) / len(viols), 4) if viols else 0, "by_type": by_type, "timeline": timeline, "model": {"active_weights": detector.active_weights_name, "reloaded_at": detector.reloaded_at, "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0}}


@router.get("/models/dataset", dependencies=[Depends(require_admin)])
def get_dataset_info():
    return get_dataset_stats(PROJECT_ROOT)


@router.post("/models/dataset/upload")
def upload_training_sample(file: UploadFile = File(...), violation_type: str = Form(...), bbox: str = Form(...), split: str = Form("train"), db: Session = Depends(get_db)):
    if violation_type not in CLASS_MAP or split not in {"train", "val"}:
        raise HTTPException(status_code=400, detail="Некорректный класс или split")
    try:
        coords = json.loads(bbox)
        if len(coords) != 4 or any(type(x) not in (int, float) for x in coords):
            raise ValueError()
        x1, y1, x2, y2 = coords
        if not (0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Нужна подтверждённая рамка [x1,y1,x2,y2] в диапазоне 0–1")
    img = decode_image(read_upload_sync(file, settings.MAX_UPLOAD_IMAGE_MB * 1024 * 1024))
    root = PROJECT_ROOT / "ml" / "datasets" / "custom"
    name = f"user_{violation_type}_{uuid.uuid4().hex}"
    image = root / "images" / split / f"{name}.jpg"
    label = root / "labels" / split / f"{name}.txt"
    with RETRAIN_LOCK, DATASET_LOCK:
        if db.query(RetrainJob.id).filter(RetrainJob.status.in_(["queued", "running"])).first():
            raise HTTPException(status_code=409, detail="Нельзя менять датасет во время обучения")
        image.parent.mkdir(parents=True, exist_ok=True)
        label.parent.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(image), img):
            raise HTTPException(status_code=500, detail="Не удалось сохранить изображение")
        label.write_text(f"{CLASS_MAP[violation_type]} {(x1+x2)/2:.6f} {(y1+y2)/2:.6f} {x2-x1:.6f} {y2-y1:.6f}\n", encoding="utf-8")
    return {"status": "added", "filename": image.name, "violation_type": violation_type, "dataset": get_dataset_info()}


@router.get("/models/jobs", response_model=list[RetrainJobOut], dependencies=[Depends(require_admin)])
def list_retrain_jobs(db: Session = Depends(get_db)):
    return [_serialize_job(j) for j in db.query(RetrainJob).order_by(RetrainJob.id.desc()).limit(20).all()]


@router.post("/models/retrain", response_model=RetrainJobOut)
def retrain_model(payload: RetrainRequest, db: Session = Depends(get_db)):
    safe_yaml = validate_dataset_yaml(payload.dataset_yaml)
    rel_yaml = safe_yaml.relative_to(PROJECT_ROOT).as_posix()
    with RETRAIN_LOCK:
        try:
            validate_dataset(safe_yaml)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if db.query(RetrainJob).filter(RetrainJob.status.in_(["queued", "running"])).first():
            raise HTTPException(status_code=409, detail="Обучение уже выполняется")
        if not settings.ENABLE_LOCAL_TRAINING:
            try:
                if not celery_app.control.inspect(timeout=1).ping():
                    raise RuntimeError("No workers")
            except Exception as exc:
                raise HTTPException(status_code=503, detail="Воркер обучения недоступен") from exc
        job = RetrainJob(status="queued", epochs=payload.epochs, current_epoch=0, dataset_yaml=rel_yaml, details="Ожидает обучения; активация весов только вручную")
        db.add(job)
        db.commit()
        db.refresh(job)
        if settings.ENABLE_LOCAL_TRAINING:
            threading.Thread(target=execute_retrain_job, args=(job.id, payload.epochs, rel_yaml), daemon=True).start()
        else:
            try:
                retrain_model_task.delay(job.id, payload.epochs, rel_yaml)
            except Exception as exc:
                job.status = "failed"
                job.details = "Не удалось поставить задачу в очередь"
                db.commit()
                raise HTTPException(status_code=503, detail=job.details) from exc
        return _serialize_job(job)


@router.post("/models/jobs/{job_id}/activate")
def activate_model(job_id: int, db: Session = Depends(get_db)):
    with RETRAIN_LOCK:
        job = db.get(RetrainJob, job_id)
        candidate = PROJECT_ROOT / "ml" / "models" / "candidates" / f"job_{job_id}.pt"
        if not job or job.status not in {"ready", "active"} or not candidate.is_file():
            raise HTTPException(status_code=409, detail="Нет проверенного результата обучения для этой задачи")
        target = Path(settings.YOLO_CUSTOM_MODEL_PATH)
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_suffix(".tmp.pt")
        shutil.copy2(candidate, temp)
        try:
            # Validate model loading before touching the active file.
            detector.activate_candidate(temp, target)
        finally:
            temp.unlink(missing_ok=True)
        for old in db.query(RetrainJob).filter(RetrainJob.status == "active").all():
            old.status = "ready"
        job.status = "active"
        job.details = "Модель применена оператором. Метрики относятся к валидационной выборке, не ко всем камерам."
        db.commit()
    return {"status": "active", "job_id": job_id}
