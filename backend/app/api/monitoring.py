from __future__ import annotations

import json
import threading
import uuid
from io import BytesIO
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from PIL import Image, UnidentifiedImageError
from pydantic import Field, model_validator
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import verify_api_key, validate_stream_source, read_upload_sync
from app.db.models import AppSetting, Camera
from app.db.session import get_db
from app.services.camera_rules import CameraRules, StrictModel, load_rules
from app.services.camera_probe import probe_stream
from app.services.stream_manager import stream_manager

router = APIRouter(prefix="/api", dependencies=[Depends(verify_api_key)])
REGISTRY_LOCK = threading.RLock()


def admin(request: Request, _=Depends(verify_api_key)):
    if request.state.principal.get("role") != "admin":
        raise HTTPException(403, "Требуются права администратора")


def camera(db, camera_id):
    row = db.get(Camera, camera_id)
    if not row or row.rtsp_url == "lab://uploads":
        raise HTTPException(404, "Камера не найдена")
    return row


@router.get("/cameras/{camera_id}/rules")
def get_rules(camera_id: int, db: Session = Depends(get_db)):
    camera(db, camera_id)
    return load_rules(db, camera_id)


@router.put("/cameras/{camera_id}/rules", dependencies=[Depends(admin)])
def put_rules(camera_id: int, payload: CameraRules, db: Session = Depends(get_db)):
    with REGISTRY_LOCK:
        camera(db, camera_id)
        db.merge(AppSetting(key=f"camera_rules:{camera_id}", value=payload.model_dump_json()))
        db.commit()
        stream_manager.update_rules(camera_id, payload)
    return payload


class Probe(StrictModel):
    camera_id: int | None = Field(default=None, gt=0)
    rtsp_url: str | None = Field(default=None, min_length=1, max_length=512)

    @model_validator(mode="after")
    def exactly_one(self):
        if len(self.model_fields_set) != 1 or (self.camera_id is None and self.rtsp_url is None):
            raise ValueError("Provide exactly camera_id or rtsp_url")
        return self


@router.post("/cameras/probe", dependencies=[Depends(admin)])
def probe(payload: Probe, db: Session = Depends(get_db)):
    source = camera(db, payload.camera_id).rtsp_url if payload.camera_id else payload.rtsp_url
    # Validation (including DNS) runs inside the same killable timeout as capture.
    return probe_stream(source)


def plans(db):
    row = db.get(AppSetting, "floor_plans")
    return json.loads(row.value) if row else []


def save_plans(db, items):
    db.merge(AppSetting(key="floor_plans", value=json.dumps(items)))
    db.commit()


@router.get("/floor-plans")
def get_plans(db: Session = Depends(get_db)):
    with REGISTRY_LOCK:
        items = plans(db)
        ids = {c.id for c in db.query(Camera).filter(Camera.rtsp_url != "lab://uploads").all()}
        changed = False
        for item in items:
            clean = [p for p in item["placements"] if p["camera_id"] in ids]
            changed |= clean != item["placements"]
            item["placements"] = clean
        if changed:
            save_plans(db, items)
        return items


@router.post("/floor-plans", dependencies=[Depends(admin)], status_code=201)
def add_plan(name: Annotated[str, Form(min_length=1, max_length=120)], file: UploadFile = File(...), db: Session = Depends(get_db)):
    raw = read_upload_sync(file, 8 * 1024 * 1024)
    try:
        with Image.open(BytesIO(raw)) as image:
            if image.format not in {"PNG", "JPEG"} or image.width * image.height > 16_000_000 or max(image.size) > 8192:
                raise HTTPException(400, "Недопустимый формат или размер изображения")
            image.load()
            clean = image.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(400, "Некорректное изображение")
    with REGISTRY_LOCK:
        items = plans(db)
        if len(items) >= 10:
            raise HTTPException(409, "Допускается не более 10 планов")
        plan_id = uuid.uuid4().hex
        folder = settings.MEDIA_ROOT / "floorplans"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{plan_id}.jpg"
        item = dict(id=plan_id, name=name.strip(), image_url=f"/media/floorplans/{plan_id}.jpg", width=clean.width, height=clean.height, placements=[])
        if not item["name"]:
            raise HTTPException(422, "Укажите название")
        try:
            clean.save(path, "JPEG", quality=88)
            save_plans(db, [*items, item])
        except Exception:
            db.rollback()
            path.unlink(missing_ok=True)
            raise
        return item


class Placement(StrictModel):
    camera_id: int = Field(gt=0)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class Placements(StrictModel):
    placements: list[Placement] = Field(max_length=256)


@router.put("/floor-plans/{plan_id}/placements", dependencies=[Depends(admin)])
def put_placements(plan_id: str, payload: Placements, db: Session = Depends(get_db)):
    with REGISTRY_LOCK:
        items = plans(db)
        item = next((p for p in items if p["id"] == plan_id), None)
        if not item:
            raise HTTPException(404, "План не найден")
        ids = [p.camera_id for p in payload.placements]
        if len(ids) != len(set(ids)):
            raise HTTPException(422, "Повторяющиеся камеры")
        for camera_id in ids:
            camera(db, camera_id)
        item["placements"] = [p.model_dump() for p in payload.placements]
        save_plans(db, items)
        return item


@router.delete("/floor-plans/{plan_id}", dependencies=[Depends(admin)])
def delete_plan(plan_id: str, db: Session = Depends(get_db)):
    with REGISTRY_LOCK:
        items = plans(db)
        item = next((p for p in items if p["id"] == plan_id), None)
        if not item:
            raise HTTPException(404, "План не найден")
        save_plans(db, [p for p in items if p["id"] != plan_id])
        # Only generated IDs may be used as filesystem components.
        if len(plan_id) == 32 and all(c in "0123456789abcdef" for c in plan_id):
            (settings.MEDIA_ROOT / "floorplans" / f"{plan_id}.jpg").unlink(missing_ok=True)
        return {"ok": True}
