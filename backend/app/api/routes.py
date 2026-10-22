from __future__ import annotations

import asyncio
import csv
import io
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.api.schemas import (
    CameraCreate,
    CameraDetectorUpdate,
    CameraOut,
    SimulateRequest,
    ViolationOut,
)
from app.api.serializers import serialize_camera, serialize_violation
from app.core.auth import require_permissions
from app.core.config import settings
from app.core.detector_profiles import DETECTOR_PROFILES, profile_catalog
from app.core.permissions import Permission, role_permissions
from app.core.security import (
    read_upload_limited,
    safe_delete_media_file,
    validate_stream_source,
)
from app.db.models import Camera, ModelVersion, User, Violation
from app.db.session import SessionLocal, get_db
from app.models.detector import detector
from app.services.audit import record_audit
from app.services.hls import playlist_path as hls_playlist_path, resolve_segment as resolve_hls_segment
from app.services.stream_manager import encode_h264_clip, stream_manager

router = APIRouter(prefix="/api")


# ─── Камеры ───────────────────────────────────────────────────────────────────

@router.get("/cameras", response_model=list[CameraOut])
def list_cameras(
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.CAMERAS_VIEW)),
):
    cams = db.query(Camera).order_by(Camera.id.asc()).all()
    # rtsp_url маскируется в сериализаторе — логины/пароли камер не уходят на фронтенд
    return [serialize_camera(c) for c in cams]


@router.post("/cameras", response_model=CameraOut, status_code=status.HTTP_201_CREATED)
def add_camera(
    payload: CameraCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.CAMERAS_MANAGE)),
):
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
    stream_manager.start_camera(
        cam.id, cam.name, cam.rtsp_url, is_active=True, detector_profile=cam.detector_profile
    )
    record_audit(
        db,
        action="camera.create",
        request=request,
        user=user,
        entity_type="camera",
        entity_id=cam.id,
        detail={"name": cam.name, "location": cam.location, "rtsp_url": cam.rtsp_url},
    )
    return serialize_camera(cam)


@router.post("/cameras/{camera_id}/toggle", response_model=CameraOut)
def toggle_camera(
    camera_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.CAMERAS_MANAGE)),
):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Камера не найдена")
    cam.is_active = not cam.is_active
    db.commit()
    db.refresh(cam)
    stream_manager.set_paused(cam.id, paused=not cam.is_active)
    record_audit(
        db,
        action="camera.toggle",
        request=request,
        user=user,
        entity_type="camera",
        entity_id=cam.id,
        detail={"name": cam.name, "is_active": cam.is_active},
    )
    return serialize_camera(cam)


@router.patch("/cameras/{camera_id}/detector", response_model=CameraOut)
def update_camera_detector(
    camera_id: int,
    payload: CameraDetectorUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.CAMERAS_MANAGE)),
):
    """
    Админ выбирает, какие модели YOLO работают на конкретной камере.

    Профиль применяется на лету — воркер камеры переключает набор моделей
    без перезапуска потока и без разрыва HLS/MJPEG.
    """
    profile = (payload.profile or "").strip().lower()
    if profile not in DETECTOR_PROFILES:
        raise HTTPException(
            status_code=422,
            detail=(
                "Неизвестный профиль детекции. Доступны: "
                + ", ".join(DETECTOR_PROFILES.keys())
            ),
        )

    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Камера не найдена")

    previous = cam.detector_profile or "ensemble"
    cam.detector_profile = profile
    db.commit()
    db.refresh(cam)
    stream_manager.set_detector_profile(cam.id, profile)

    record_audit(
        db,
        action="camera.detector.update",
        request=request,
        user=user,
        entity_type="camera",
        entity_id=cam.id,
        detail={
            "name": cam.name,
            "previous_profile": previous,
            "detector_profile": profile,
            "components": list(DETECTOR_PROFILES[profile].components),
        },
    )
    return serialize_camera(cam)


@router.get("/detector/profiles")
def detector_profiles(_: User = Depends(require_permissions(Permission.CAMERAS_VIEW))):
    """Справочник профилей детекции — нужен UI выбора моделей на камере."""
    db = SessionLocal()
    try:
        counts: dict[str, int] = {}
        for cam in db.query(Camera).all():
            key = cam.detector_profile or settings.DETECTOR_PROFILE
            counts[key] = counts.get(key, 0) + 1
    finally:
        db.close()
    return {"profiles": profile_catalog(counts)}


@router.post("/cameras/{camera_id}/simulate")
def simulate_camera_event(
    camera_id: int,
    payload: SimulateRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.CAMERAS_SIMULATE)),
):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Камера не найдена")
    ok = stream_manager.trigger_scenario(camera_id, payload.scenario)
    if not ok:
        raise HTTPException(status_code=400, detail="Симуляция доступна только для виртуальных потоков sim://")
    record_audit(
        db,
        action="camera.simulate",
        request=request,
        user=user,
        entity_type="camera",
        entity_id=camera_id,
        detail={"scenario": payload.scenario},
    )
    return {"status": "triggered", "camera_id": camera_id, "scenario": payload.scenario}


@router.delete("/cameras/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_camera(
    camera_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.CAMERAS_MANAGE)),
):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Камера не найдена")
    stream_manager.stop_camera(camera_id)
    media_deleted = 0
    for v in cam.violations:
        if safe_delete_media_file(v.image_path):
            media_deleted += 1
        if safe_delete_media_file(v.video_path):
            media_deleted += 1
    name = cam.name
    db.delete(cam)
    db.commit()
    record_audit(
        db,
        action="camera.delete",
        request=request,
        user=user,
        entity_type="camera",
        entity_id=camera_id,
        detail={"name": name, "media_files_deleted": media_deleted},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/cameras/{camera_id}/snapshot")
def camera_snapshot(
    camera_id: int,
    _: User = Depends(require_permissions(Permission.CAMERAS_VIEW)),
):
    frame = stream_manager.get_frame(camera_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Кадр ещё не готов")
    return Response(
        content=frame,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/cameras/{camera_id}/stream")
async def stream_camera(
    camera_id: int,
    request: Request,
    _: User = Depends(require_permissions(Permission.CAMERAS_VIEW)),
):
    """
    MJPEG-поток. Авторизация работает через HttpOnly cookie: браузер сам прикладывает её
    к запросу <img src="/api/cameras/N/stream">, поэтому тег не требует токена в URL.
    """
    db = SessionLocal()
    try:
        cam = db.query(Camera).filter(Camera.id == camera_id).first()
        if not cam:
            raise HTTPException(status_code=404, detail="Камера не найдена")
        camera_name = cam.name
    finally:
        db.close()

    async def mjpeg_generator():
        last_sent_seq = -1
        try:
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
        except (asyncio.CancelledError, GeneratorExit):
            return

    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            # HTTP-заголовки допускают только latin-1: кириллическое имя камеры
            # передаём в percent-encoding, иначе Starlette падает с UnicodeEncodeError.
            "X-Camera-Name": quote(camera_name[:80], safe=""),
        },
    )


@router.get("/cameras/{camera_id}/hls/index.m3u8")
def camera_hls_playlist(
    camera_id: int,
    _: User = Depends(require_permissions(Permission.CAMERAS_VIEW)),
):
    """
    HLS-плейлист камеры.

    Аннотированные кадры (рамки YOLO + HUD) кодируются в H.264 и нарезаются на
    mpeg-ts сегменты: браузер играет обычный <video> вместо MJPEG-перерисовки.
    Сегменты лежат рядом, поэтому hls.js запрашивает их относительно плейлиста.
    """
    path = hls_playlist_path(camera_id)
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail="HLS-поток ещё не готов. Подождите несколько секунд после старта камеры.",
        )
    return FileResponse(
        path,
        media_type="application/vnd.apple.mpegurl",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@router.get("/cameras/{camera_id}/hls/{segment}")
def camera_hls_segment(
    camera_id: int,
    segment: str,
    _: User = Depends(require_permissions(Permission.CAMERAS_VIEW)),
):
    path = resolve_hls_segment(camera_id, segment)
    if path is None:
        raise HTTPException(status_code=404, detail="Сегмент не найден")
    return FileResponse(
        path,
        media_type="video/mp2t",
        headers={"Cache-Control": "no-cache"},
    )


# ─── Нарушения и видеофрагменты ───────────────────────────────────────────────

@router.get("/violations", response_model=list[ViolationOut])
def list_violations(
    violation_type: str | None = None,
    camera_id: int | None = None,
    unacknowledged_only: bool = False,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.VIOLATIONS_VIEW)),
):
    query = db.query(Violation).outerjoin(Camera)
    if violation_type:
        query = query.filter(Violation.violation_type == violation_type)
    if camera_id:
        query = query.filter(Violation.camera_id == camera_id)
    if unacknowledged_only:
        query = query.filter(Violation.is_acknowledged.is_(False))

    rows = query.order_by(Violation.detected_at.desc(), Violation.id.desc()).limit(min(limit, 500)).all()
    return [serialize_violation(r) for r in rows]


@router.get("/violations/export")
def export_violations(
    request: Request,
    violation_type: str | None = None,
    camera_id: int | None = None,
    unacknowledged_only: bool = False,
    limit: int = 5000,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.VIOLATIONS_VIEW)),
):
    """
    Выгрузка журнала нарушений в CSV (разделитель «;», UTF-8 с BOM — открывается в Excel).

    Учитывает те же фильтры, что и таблица на дашборде, поэтому выгружается
    ровно то, что пользователь видит на экране.
    """
    query = db.query(Violation).outerjoin(Camera)
    if violation_type:
        query = query.filter(Violation.violation_type == violation_type)
    if camera_id:
        query = query.filter(Violation.camera_id == camera_id)
    if unacknowledged_only:
        query = query.filter(Violation.is_acknowledged.is_(False))

    rows = (
        query.order_by(Violation.detected_at.desc(), Violation.id.desc())
        .limit(max(1, min(limit, 20000)))
        .all()
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(
        [
            "id",
            "detected_at",
            "camera",
            "location",
            "violation_type",
            "confidence",
            "track_id",
            "dwell_seconds",
            "acknowledged",
            "acknowledged_by",
            "acknowledged_at",
            "image_path",
            "video_path",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row.id,
                (row.detected_at or datetime.now(timezone.utc)).isoformat(),
                row.camera.name if row.camera else f"Камера #{row.camera_id}",
                row.camera.location if row.camera else "",
                row.violation_type,
                f"{row.confidence:.4f}",
                row.track_id or "",
                "" if row.dwell_seconds is None else f"{row.dwell_seconds:.2f}",
                "да" if row.is_acknowledged else "нет",
                row.acknowledged_by or "",
                row.acknowledged_at.isoformat() if row.acknowledged_at else "",
                row.image_path,
                row.video_path,
            ]
        )

    record_audit(
        db,
        action="violations.export",
        request=request,
        user=user,
        entity_type="violations",
        detail={
            "exported_rows": len(rows),
            "violation_type": violation_type,
            "camera_id": camera_id,
            "unacknowledged_only": unacknowledged_only,
        },
    )

    filename = datetime.now(timezone.utc).strftime("school_security_violations_%Y%m%d_%H%M.csv")
    return Response(
        content="\ufeff" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch("/violations/{violation_id}/ack", response_model=ViolationOut)
def acknowledge_violation(
    violation_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.VIOLATIONS_ACK)),
):
    row = db.query(Violation).filter(Violation.id == violation_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Инцидент не найден")
    row.is_acknowledged = not row.is_acknowledged
    row.acknowledged_by = user.username if row.is_acknowledged else None
    row.acknowledged_at = datetime.now(timezone.utc) if row.is_acknowledged else None
    db.commit()
    db.refresh(row)
    record_audit(
        db,
        action="violation.ack",
        request=request,
        user=user,
        entity_type="violation",
        entity_id=row.id,
        detail={
            "violation_type": row.violation_type,
            "camera_id": row.camera_id,
            "is_acknowledged": row.is_acknowledged,
            "track_id": row.track_id,
        },
    )
    return serialize_violation(row)


@router.delete("/violations/{violation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_violation(
    violation_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.VIOLATIONS_DELETE)),
):
    row = db.query(Violation).filter(Violation.id == violation_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Инцидент не найден")
    payload = {
        "violation_type": row.violation_type,
        "camera_id": row.camera_id,
        "confidence": row.confidence,
        "image_path": row.image_path,
        "video_path": row.video_path,
        "detected_at": row.detected_at,
    }
    safe_delete_media_file(row.image_path)
    safe_delete_media_file(row.video_path)
    db.delete(row)
    db.commit()
    record_audit(
        db,
        action="violation.delete",
        request=request,
        user=user,
        entity_type="violation",
        entity_id=violation_id,
        detail=payload,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/violations/{violation_id}/video")
def get_violation_video(
    violation_id: int,
    request: Request,
    download: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.VIOLATIONS_VIEW)),
):
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

    record_audit(
        db,
        action="violation.video_download" if download else "violation.video_view",
        request=request,
        user=user,
        entity_type="violation",
        entity_id=row.id,
        detail={"violation_type": row.violation_type, "file": file_path.name},
    )
    return FileResponse(
        path=str(file_path),
        media_type="video/mp4",
        filename=f"incident_{row.id}.mp4" if download else None,
        headers={"Cache-Control": "private, max-age=600"},
    )


# ─── Интерактивная проверка произвольных фото / видео ─────────────────────────

@router.post("/analyze/upload")
async def analyze_uploaded_media(
    request: Request,
    file: UploadFile = File(...),
    save_violation: bool = Form(default=True),
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.MEDIA_CHECK)),
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

        record_audit(
            db,
            action="media.analyze",
            request=request,
            user=user,
            entity_type="media",
            detail={
                "filename": file.filename,
                "media_type": "image",
                "size_bytes": len(content),
                "violations": [v["type"] for v in analysis["violations"]],
                "saved_violation_ids": saved_ids,
            },
        )

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

    record_audit(
        db,
        action="media.analyze",
        request=request,
        user=user,
        entity_type="media",
        detail={
            "filename": file.filename,
            "media_type": "video",
            "size_bytes": len(content),
            "frames_processed": len(frames_out),
            "violations": list(best_by_type.keys()),
        },
    )

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
def get_dashboard_stats(
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.CAMERAS_VIEW)),
):
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

    production = (
        db.query(ModelVersion).filter(ModelVersion.status == "production").order_by(ModelVersion.id.desc()).first()
    )
    dwell_values = [v.dwell_seconds for v in viols if v.dwell_seconds is not None]

    return {
        "total_cameras": len(cams),
        "active_cameras": sum(1 for c in cams if c.is_active),
        "total_violations": len(viols),
        "unacknowledged_violations": unack_count,
        "average_confidence": avg_conf,
        "by_type": by_type,
        "timeline": buckets,
        "tracking": {
            "enabled": settings.TRACKER_ENABLED,
            "dwell_threshold_sec": settings.UNATTENDED_DWELL_SEC,
            "avg_dwell_seconds": round(sum(dwell_values) / len(dwell_values), 1) if dwell_values else 0.0,
            "bag_tracks_active": sum(
                len([t for t in stream_manager.get_telemetry(c.id).get("bag_tracking", []) if t.get("state") == "holding"])
                for c in cams
            ),
        },
        "model": {
            "active_weights": detector.active_weights_name,
            "reloaded_at": detector.reloaded_at,
            "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0.0,
            "production_version": production.label if production else None,
            "production_map50": production.map50 if production else None,
        },
    }


@router.get("/system/status")
def system_status(
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.CAMERAS_VIEW)),
):
    production = db.query(ModelVersion).filter(ModelVersion.status == "production").order_by(ModelVersion.id.desc()).first()
    return {
        "version": settings.APP_VERSION,
        "project": settings.PROJECT_NAME,
        "auth": {
            "scheme": "JWT + HttpOnly cookie",
            "cookie_name": settings.AUTH_COOKIE_NAME,
            "demo_login": settings.DEMO_LOGIN_ENABLED,
        },
        "roles": {"current": user.role, "permissions": role_permissions(user.role)},
        "tracking": {
            "backend": "ByteTrack-style IoU tracker",
            "dwell_threshold_sec": settings.UNATTENDED_DWELL_SEC,
            "iou_threshold": settings.TRACK_IOU_THRESHOLD,
            "max_age_sec": settings.TRACK_MAX_AGE_SEC,
            "min_hits": settings.TRACK_MIN_HITS,
        },
        "validation_gate": {
            "map50_tolerance": settings.MAP50_ROLLBACK_TOLERANCE,
            "map50_min_absolute": settings.MAP50_MIN_ABSOLUTE,
        },
        "model": {
            "active_weights": detector.active_weights_name,
            "production_version": production.label if production else None,
            "production_map50": production.map50 if production else None,
            "reloaded_at": detector.reloaded_at,
        },
    }
