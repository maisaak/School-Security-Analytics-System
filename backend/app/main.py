from __future__ import annotations

from contextlib import asynccontextmanager
import threading
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse

from app.api.routes import router
from app.api.auth import router as auth_router
from app.api.employees import router as employees_router
from app.api.settings import router as settings_router, MODEL_CATALOG
from app.core.config import settings
from app.core.security import verify_api_key
from app.db.models import AppSetting, Camera, RetrainJob
from app.models.detector import detector
from app.core.config import PROJECT_ROOT
from app.db.session import Base, SessionLocal, engine
from app.services.stream_manager import stream_manager
from app.services.maintenance import run_maintenance

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
        saved_model = db.get(AppSetting, "base_model")
        if saved_model and saved_model.value in {e["filename"] for e in MODEL_CATALOG.values()}:
            target = PROJECT_ROOT / "ml" / "models" / saved_model.value
            if target.is_file():
                detector.select_base_model(target)
        if settings.SEED_DEMO_CAMERAS and db.query(Camera).count() == 0:
            for item in DEFAULT_CAMERAS:
                db.add(Camera(**item, is_active=True))
            db.commit()

        # Preserve legacy history but stop presenting the old seeded numbers as measurements.
        for job in db.query(RetrainJob).filter(RetrainJob.details.like("Базовые дообученные веса school_security_best.pt активны%")):
            job.status = "legacy_unverified"
            job.details = "Неподтверждённые демонстрационные метрики старой версии; не оценка активной модели"
        db.commit()

        for cam in db.query(Camera).all():
            stream_manager.start_camera(cam.id, cam.name, cam.rtsp_url, is_active=cam.is_active)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not settings.DEV_MODE and len(settings.API_KEY) < 32:
        raise RuntimeError("Задайте API_KEY длиной не менее 32 символов (python scripts/setup_env.py)")
    if not settings.DEV_MODE and "*" in settings.CORS_ORIGINS:
        raise RuntimeError("Wildcard CORS запрещён вне DEV_MODE")
    Base.metadata.create_all(bind=engine)
    _seed_initial_state()
    stop = threading.Event()
    maintenance = threading.Thread(target=run_maintenance, args=(stop,), daemon=True)
    maintenance.start()
    try:
        yield
    finally:
        stop.set()
        maintenance.join(timeout=5)
        stream_manager.stop_all()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description="Система видеомониторинга школьной безопасности с детекцией угроз через YOLOv8",
    lifespan=lifespan,
)

wildcard_cors = "*" in settings.CORS_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=not wildcard_cors,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(auth_router)
app.include_router(employees_router)
app.include_router(settings_router)


@app.get("/media/{media_path:path}", dependencies=[Depends(verify_api_key)])
def protected_media(media_path: str):
    root = settings.MEDIA_ROOT.resolve()
    target = (root / media_path).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(status_code=404, detail="Файл не найден")
    return FileResponse(target, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@app.get("/", include_in_schema=False)
def root_redirect():
    return RedirectResponse(url="/docs")


@app.get("/health")
def healthcheck():
    return {"status": "ok", "service": settings.PROJECT_NAME}
