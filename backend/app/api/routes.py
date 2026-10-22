from __future__ import annotations

import asyncio
import json
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.api.schemas import (
    CameraCreate,
    CameraOut,
    RetrainJobOut,
    RetrainRequest,
    SimulateRequest,
    ViolationOut,
)
from app.core.config import PROJECT_ROOT, settings
from app.core.security import (
    read_upload_limited,
    safe_delete_media_file,
    validate_dataset_yaml,
    validate_stream_source,
    verify_api_key,
)
from app.db.models import Camera, RetrainJob, Violation
from app.db.session import get_db
from app.models.detector import detector
from app.services.stream_manager import encode_h264_clip, stream_manager
from app.services.tasks import celery_app, execute_retrain_job, retrain_model_task

router = APIRouter(prefix="/api", dependencies=[Depends(verify_api_key)])
RETRAIN_LOCK = threading.Lock()


def _serialize_camera(cam: Camera) -> CameraOut:
    tel = stream_manager.get_telemetry(cam.id)
    return CameraOut(
        id=cam.id,
        name=cam.name,
        location=cam.location,
        rtsp_url=cam.rtsp_url,
        is_active=cam.is_active,
        created_at=cam.created_at,
        **tel,
    )


def _serialize_violation(v: Violation) -> ViolationOut:
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
    )


def _serialize_job(job: RetrainJob) -> RetrainJobOut:
    try:
        metrics = {k: float(v) for k, v in json.loads(job.metrics_json or "{}").items()}
    except Exception:
        metrics = {}
    pct = 100 if job.status == "completed" else int(round((job.current_epoch / max(1, job.epochs)) * 100))
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
    )


# ─── Камеры ───────────────────────────────────────────────────────────────────

@router.post("/cameras", response_model=CameraOut, status_code=status.HTTP_201_CREATED)
def add_camera(payload: CameraCreate, db: Session = Depends(get_db)):
    validated_url = validate_stream_source(payload.rtsp_url)
    cam = Camera(
        name=payload.name.strip(),
        location=payload.location.strip() or "Периметр школы",
        rtsp_url=validated_url,
        is_active=True,
    )
    db.add(cam)
    db.commit()
    db.refresh(cam)
    stream_manager.start_camera(cam.id, cam.name, cam.rtsp_url, is_active=True)
    return _serialize_camera(cam)


@router.get("/cameras", response_model=list[CameraOut])
def list_cameras(db: Session = Depends(get_db)):
    cams = db.query(Camera).order_by(Camera.id.asc()).all()
    return [_serialize_camera(c) for c in cams]


@router.post("/cameras/{camera_id}/toggle", response_model=CameraOut)
def toggle_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Камера не найдена")
    cam.is_active = not cam.is_active
    db.commit()
    db.refresh(cam)
    stream_manager.set_paused(cam.id, paused=not cam.is_active)
    return _serialize_camera(cam)


@router.post("/cameras/{camera_id}/simulate")
def simulate_camera_event(camera_id: int, payload: SimulateRequest, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Камера не найдена")
    ok = stream_manager.trigger_scenario(camera_id, payload.scenario)
    if not ok:
        raise HTTPException(status_code=400, detail="Симуляция доступна только для виртуальных потоков sim://")
    return {"status": "triggered", "camera_id": camera_id, "scenario": payload.scenario}


@router.delete("/cameras/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Камера не найдена")
    stream_manager.stop_camera(camera_id)
    for v in cam.violations:
        safe_delete_media_file(v.image_path)
        safe_delete_media_file(v.video_path)
    db.delete(cam)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/cameras/{camera_id}/snapshot")
def camera_snapshot(camera_id: int):
    frame = stream_manager.get_frame(camera_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Кадр ещё не готов")
    return Response(content=frame, media_type="image/jpeg")


@router.get("/cameras/{camera_id}/stream")
async def stream_camera(camera_id: int, request: Request, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Камера не найдена")

    async def mjpeg_generator():
        last_sent_seq = -1
        while True:
            if await request.is_disconnected():
                break
            if not stream_manager.has_camera(camera_id):
                break
            frame, seq = stream_manager.get_frame_with_seq(camera_id)
            if frame and seq != last_sent_seq:
                last_sent_seq = seq
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
            await asyncio.sleep(1.0 / 15.0)

    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


# ─── Нарушения и видеофрагменты ───────────────────────────────────────────────

@router.get("/violations", response_model=list[ViolationOut])
def list_violations(
    violation_type: str | None = None,
    camera_id: int | None = None,
    unacknowledged_only: bool = False,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    query = db.query(Violation).outerjoin(Camera)
    if violation_type:
        query = query.filter(Violation.violation_type == violation_type)
    if camera_id:
        query = query.filter(Violation.camera_id == camera_id)
    if unacknowledged_only:
        query = query.filter(Violation.is_acknowledged.is_(False))

    rows = query.order_by(Violation.detected_at.desc(), Violation.id.desc()).limit(min(limit, 500)).all()
    return [_serialize_violation(r) for r in rows]


@router.patch("/violations/{violation_id}/ack", response_model=ViolationOut)
def acknowledge_violation(violation_id: int, db: Session = Depends(get_db)):
    row = db.query(Violation).filter(Violation.id == violation_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Инцидент не найден")
    row.is_acknowledged = not row.is_acknowledged
    db.commit()
    db.refresh(row)
    return _serialize_violation(row)


@router.delete("/violations/{violation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_violation(violation_id: int, db: Session = Depends(get_db)):
    row = db.query(Violation).filter(Violation.id == violation_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Инцидент не найден")
    safe_delete_media_file(row.image_path)
    safe_delete_media_file(row.video_path)
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/violations/{violation_id}/video")
def get_violation_video(violation_id: int, db: Session = Depends(get_db)):
    row = db.query(Violation).filter(Violation.id == violation_id).first()
    if not row or not row.video_path:
        raise HTTPException(status_code=404, detail="Видеозапись инцидента не найдена")

    rel = row.video_path.removeprefix("/media/")
    media_root = settings.MEDIA_ROOT.resolve()
    file_path = (media_root / rel).resolve()
    try:
        file_path.relative_to(media_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Недопустимый путь видеофайла") from exc

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Видеофайл отсутствует на диске")

    return FileResponse(path=str(file_path), media_type="video/mp4", filename=file_path.name)


# ─── Интерактивная проверка произвольных фото / видео ─────────────────────────

@router.post("/analyze/upload")
async def analyze_uploaded_media(
    file: UploadFile = File(...),
    save_violation: bool = Form(default=True),
    db: Session = Depends(get_db),
):
    suffix = Path(file.filename or "upload.jpg").suffix.lower()
    is_video = suffix in {".mp4", ".avi", ".mov", ".mkv", ".webm"}
    max_bytes = (settings.MAX_UPLOAD_VIDEO_MB if is_video else settings.MAX_UPLOAD_IMAGE_MB) * 1024 * 1024
    content = await read_upload_limited(file, max_bytes=max_bytes)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")

    if not is_video:
        arr = np.frombuffer(content, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(status_code=400, detail="Не удалось декодировать изображение")

        if img.shape[0] > 4096 or img.shape[1] > 4096:
            img = cv2.resize(img, (1280, int(1280 * img.shape[0] / img.shape[1])), interpolation=cv2.INTER_AREA)

        annotated, analysis = detector.analyze_frame(img, camera_title="ПРОВЕРКА МЕДИАФАЙЛА")
        out_rel = f"uploads/analyzed_{stamp}.jpg"
        cv2.imwrite(str(settings.MEDIA_ROOT / out_rel), annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 90])

        saved_ids: list[int] = []
        if save_violation and analysis["violations"]:
            first_cam = db.query(Camera).order_by(Camera.id.asc()).first()
            if first_cam:
                vid_rel = f"videos/upload_{stamp}.mp4"
                encode_h264_clip([annotated] * 24, settings.MEDIA_ROOT / vid_rel, fps=12.0)
                for item in analysis["violations"]:
                    rec = Violation(
                        camera_id=first_cam.id,
                        violation_type=item["type"],
                        confidence=item["confidence"],
                        bbox_json=json.dumps(item["bbox"]),
                        image_path=f"/media/{out_rel}",
                        video_path=f"/media/{vid_rel}",
                    )
                    db.add(rec)
                    db.commit()
                    db.refresh(rec)
                    saved_ids.append(rec.id)

        return {
            "media_type": "image",
            "result_url": f"/media/{out_rel}",
            "violations": analysis["violations"],
            "safe_objects": analysis["safe_objects"],
            "latency_ms": analysis["latency_ms"],
            "saved_violation_ids": saved_ids,
        }

    raw_vid = settings.MEDIA_ROOT / "uploads" / f"raw_{stamp}{suffix}"
    raw_vid.write_bytes(content)

    cap = cv2.VideoCapture(str(raw_vid))
    frames_out: list[np.ndarray] = []
    aggregated_violations: list[dict] = []
    idx = 0
    last_an = {"violations": [], "safe_objects": [], "latency_ms": 0.0}

    try:
        while len(frames_out) < 90:
            ok, frm = cap.read()
            if not ok or frm is None:
                break
            frm = cv2.resize(frm, (960, 540), interpolation=cv2.INTER_AREA)
            if idx % 3 == 0:
                last_an = detector.detect_frame(frm)
                for v in last_an["violations"]:
                    aggregated_violations.append(v)
            ann = detector.annotate_frame(frm, last_an, camera_title="ПРОВЕРКА ВИДЕОФАЙЛА")
            frames_out.append(ann)
            idx += 1
    finally:
        cap.release()
        raw_vid.unlink(missing_ok=True)

    if not frames_out:
        raise HTTPException(status_code=400, detail="Не удалось прочитать кадры видео")

    out_vid_rel = f"uploads/analyzed_{stamp}.mp4"
    encode_h264_clip(frames_out, settings.MEDIA_ROOT / out_vid_rel, fps=12.0)

    best_by_type: dict[str, dict] = {}
    for v in aggregated_violations:
        if v["type"] not in best_by_type or v["confidence"] > best_by_type[v["type"]]["confidence"]:
            best_by_type[v["type"]] = v

    return {
        "media_type": "video",
        "result_url": f"/media/{out_vid_rel}",
        "violations": list(best_by_type.values()),
        "safe_objects": [],
        "frames_processed": len(frames_out),
        "saved_violation_ids": [],
    }


# ─── Аналитика и статистика ───────────────────────────────────────────────────

@router.get("/stats")
def get_dashboard_stats(db: Session = Depends(get_db)):
    cams = db.query(Camera).all()
    viols = db.query(Violation).order_by(Violation.detected_at.desc()).all()

    by_type = {"weapon": 0, "suspicious_bag": 0, "dog": 0}
    unack_count = 0
    for v in viols:
        by_type[v.violation_type] = by_type.get(v.violation_type, 0) + 1
        if not v.is_acknowledged:
            unack_count += 1

    now = datetime.now(timezone.utc)
    buckets = []
    for i in range(7, -1, -1):
        start_t = now - timedelta(minutes=(i + 1) * 5)
        end_t = now - timedelta(minutes=i * 5)
        cnt = sum(
            1
            for v in viols
            if start_t <= (v.detected_at if v.detected_at.tzinfo else v.detected_at.replace(tzinfo=timezone.utc)) < end_t
        )
        buckets.append({"label": end_t.astimezone().strftime("%H:%M"), "count": cnt})

    avg_conf = round(sum(v.confidence for v in viols) / len(viols), 4) if viols else 0.0
    latencies = [stream_manager.get_telemetry(c.id)["latency_ms"] for c in cams if c.is_active]

    return {
        "total_cameras": len(cams),
        "active_cameras": sum(1 for c in cams if c.is_active),
        "total_violations": len(viols),
        "unacknowledged_violations": unack_count,
        "average_confidence": avg_conf,
        "by_type": by_type,
        "timeline": buckets,
        "model": {
            "active_weights": detector.active_weights_name,
            "reloaded_at": detector.reloaded_at,
            "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0.0,
        },
    }


# ─── Дообучение модели и управление датасетом ─────────────────────────────────

@router.get("/models/dataset")
def get_dataset_info():
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))
    from ml.datasets.generate_dataset import ensure_custom_dataset

    return ensure_custom_dataset(PROJECT_ROOT)


@router.post("/models/dataset/upload")
async def upload_training_sample(
    file: UploadFile = File(...),
    violation_type: str = Form(...),
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
            bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(xs.max())]
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

    return {
        "status": "added",
        "filename": img_out.name,
        "violation_type": violation_type,
        "dataset": get_dataset_info(),
    }


@router.get("/models/jobs", response_model=list[RetrainJobOut])
def list_retrain_jobs(db: Session = Depends(get_db)):
    jobs = db.query(RetrainJob).order_by(RetrainJob.id.desc()).limit(20).all()
    return [_serialize_job(j) for j in jobs]


@router.post("/models/retrain", response_model=RetrainJobOut)
def retrain_model(payload: RetrainRequest, db: Session = Depends(get_db)):
    safe_yaml = validate_dataset_yaml(payload.dataset_yaml)
    rel_yaml = safe_yaml.relative_to(PROJECT_ROOT).as_posix()

    with RETRAIN_LOCK:
        active = db.query(RetrainJob).filter(RetrainJob.status.in_(["queued", "running"])).first()
        if active:
            raise HTTPException(status_code=409, detail=f"Задача дообучения #{active.id} уже выполняется")

        job = RetrainJob(
            status="queued",
            epochs=payload.epochs,
            current_epoch=0,
            dataset_yaml=rel_yaml,
            details="Поставлена в очередь обучения",
        )
        db.add(job)
        db.commit()
        db.refresh(job)

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

    return _serialize_job(job)
