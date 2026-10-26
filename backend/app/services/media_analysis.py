from __future__ import annotations

import json
import math
import threading
import time
import uuid
from pathlib import Path

import cv2
import numpy as np
from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import read_upload_sync
from app.db.models import Camera, Violation
from app.models.detector import detector
from app.services.stream_manager import transcode_h264

ANALYSIS_LOCK = threading.BoundedSemaphore(1)


def decode_image(content: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Не удалось декодировать изображение")
    h, w = image.shape[:2]
    if max(h, w) > 1920:
        scale = 1920 / max(h, w)
        image = cv2.resize(image, (max(1, round(w * scale)), max(1, round(h * scale))))
    return image


def save_lab_violations(db: Session, violations: list[dict], image: str, video: str | None) -> list[int]:
    if not violations:
        return []
    camera = db.query(Camera).filter(Camera.rtsp_url == "lab://uploads").first()
    if camera is None:
        camera = Camera(name="Лаборатория · загруженные файлы", location="Не камера наблюдения", rtsp_url="lab://uploads", is_active=False)
        db.add(camera)
        db.flush()
    rows = []
    for item in violations:
        row = Violation(camera_id=camera.id, violation_type=item["type"], confidence=item["confidence"], bbox_json=json.dumps(item["bbox"]), image_path=image, video_path=video)
        db.add(row)
        rows.append(row)
    db.commit()
    return [row.id for row in rows]


def analyze_media(file: UploadFile, save_violation: bool, db: Session) -> dict:
    if not ANALYSIS_LOCK.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Другой файл уже обрабатывается. Повторите позже.")
    try:
        return _analyze(file, save_violation, db)
    finally:
        ANALYSIS_LOCK.release()


def _analyze(file: UploadFile, save_violation: bool, db: Session) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    is_video = suffix in {".mp4", ".avi", ".mov", ".mkv", ".webm"}
    if not is_video and suffix not in {".jpg", ".jpeg", ".png", ".webp", ".bmp"}:
        raise HTTPException(status_code=415, detail="Неподдерживаемый формат файла")
    limit = settings.MAX_UPLOAD_VIDEO_MB if is_video else settings.MAX_UPLOAD_IMAGE_MB
    content = read_upload_sync(file, limit * 1024 * 1024)
    stamp = uuid.uuid4().hex
    image_rel = f"uploads/analyzed_{stamp}.jpg"
    image_path = settings.MEDIA_ROOT / image_rel
    warning = "Срабатывания — кандидаты для проверки. На фото не определяется время оставления сумки."
    if not is_video:
        annotated, analysis = detector.analyze_frame(decode_image(content), camera_title="ЛАБОРАТОРИЯ")
        if not cv2.imwrite(str(image_path), annotated):
            raise HTTPException(status_code=500, detail="Ошибка сохранения изображения")
        ids = save_lab_violations(db, analysis["violations"], f"/media/{image_rel}", None) if save_violation else []
        return {"media_type": "image", "result_url": f"/media/{image_rel}", **analysis, "saved_violation_ids": ids, "warning": warning}

    raw = settings.MEDIA_ROOT / "uploads" / f"raw_{stamp}{suffix}"
    intermediate = settings.MEDIA_ROOT / "uploads" / f"temp_{stamp}.avi"
    output_rel = f"uploads/analyzed_{stamp}.mp4"
    output = settings.MEDIA_ROOT / output_rel
    raw.write_bytes(content)
    del content
    cap = cv2.VideoCapture(str(raw))
    writer = None
    frames = 0
    best: dict[str, dict] = {}
    deadline = time.monotonic() + 600
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        if not math.isfinite(fps) or not 1 <= fps <= 120:
            raise HTTPException(status_code=400, detail="Некорректная частота кадров видео (1–120 FPS)")
        max_frames = int(fps * settings.MAX_VIDEO_DURATION_SEC)
        declared = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        if declared > max_frames:
            raise HTTPException(status_code=413, detail=f"Видео длиннее {settings.MAX_VIDEO_DURATION_SEC} секунд")
        writer = cv2.VideoWriter(str(intermediate), cv2.VideoWriter_fourcc(*"MJPG"), fps, (960, 540))
        if not writer.isOpened():
            raise RuntimeError("Видеокодировщик недоступен")
        last_analysis = {"violations": [], "safe_objects": [], "latency_ms": 0}
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if frames >= max_frames:
                raise HTTPException(status_code=413, detail="Превышена длительность видео")
            if time.monotonic() > deadline:
                raise HTTPException(status_code=408, detail="Превышено время анализа видео")
            frame = cv2.resize(frame, (960, 540))
            if frames % 3 == 0:
                last_analysis = detector.detect_frame(frame)
            annotated = detector.annotate_frame(frame, last_analysis, camera_title="ЛАБОРАТОРИЯ · КАНДИДАТЫ")
            for item in last_analysis["violations"]:
                if item["type"] not in best or item["confidence"] > best[item["type"]]["confidence"]:
                    best[item["type"]] = item
                    cv2.imwrite(str(image_path), annotated)
            if frames == 0 and not image_path.exists():
                cv2.imwrite(str(image_path), annotated)
            writer.write(annotated)
            frames += 1
        if not frames:
            raise HTTPException(status_code=400, detail="Не удалось прочитать видео")
        writer.release()
        writer = None
        transcode_h264(intermediate, output)
        ids = save_lab_violations(db, list(best.values()), f"/media/{image_rel}", f"/media/{output_rel}") if save_violation else []
        return {"media_type": "video", "result_url": f"/media/{output_rel}", "violations": list(best.values()), "safe_objects": [], "frames_processed": frames, "duration_seconds": frames / fps, "saved_violation_ids": ids, "warning": warning}
    except Exception:
        image_path.unlink(missing_ok=True)
        output.unlink(missing_ok=True)
        raise
    finally:
        cap.release()
        if writer is not None:
            writer.release()
        raw.unlink(missing_ok=True)
        intermediate.unlink(missing_ok=True)
