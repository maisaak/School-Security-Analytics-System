from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.config import settings
from app.db.models import Camera, RetrainJob
from app.db.session import Base, SessionLocal, engine
from app.services.stream_manager import stream_manager

DEFAULT_CAMERAS = [
    {
        "name": "Камера №1 — Главный вход",
        "location": "Турникеты и пост охраны, 1 этаж",
        "rtsp_url": "sim://entrance",
    },
    {
        "name": "Камера №2 — Рекреация",
        "location": "Учебный коридор, правое крыло",
        "rtsp_url": "sim://hallway",
    },
    {
        "name": "Камера №3 — Школьный двор",
        "location": "Въездные ворота и периметр",
        "rtsp_url": "sim://courtyard",
    },
]


def _seed_initial_state() -> None:
    db = SessionLocal()
    try:
        if db.query(Camera).count() == 0:
            for item in DEFAULT_CAMERAS:
                db.add(Camera(**item, is_active=True))
            db.commit()

        if db.query(RetrainJob).count() == 0:
            db.add(
                RetrainJob(
                    status="completed",
                    epochs=8,
                    current_epoch=8,
                    dataset_yaml="ml/datasets/school_security.yaml",
                    metrics_json=json.dumps(
                        {
                            "metrics/precision(B)": 0.9274,
                            "metrics/recall(B)": 0.8938,
                            "metrics/mAP50(B)": 0.9772,
                            "metrics/mAP50-95(B)": 0.8095,
                            "box_loss": 0.7999,
                            "cls_loss": 1.6290,
                        }
                    ),
                    details="Базовые дообученные веса school_security_best.pt активны · mAP@50 = 97.7%",
                    completed_at=datetime.now(timezone.utc),
                )
            )
            db.commit()

        for cam in db.query(Camera).all():
            stream_manager.start_camera(cam.id, cam.name, cam.rtsp_url, is_active=cam.is_active)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    _seed_initial_state()
    yield
    stream_manager.stop_all()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description="Система видеомониторинга школьной безопасности с детекцией угроз через YOLOv8",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/media", StaticFiles(directory=str(settings.MEDIA_ROOT)), name="media")
app.include_router(router)


@app.get("/health")
def healthcheck():
    return {"status": "ok", "service": settings.PROJECT_NAME}
