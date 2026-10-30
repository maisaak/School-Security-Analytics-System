from __future__ import annotations

from contextlib import asynccontextmanager
import threading
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse

from app.api.routes import router
from app.api.auth import router as auth_router
from app.api.employees import router as employees_router
from app.api.roles import router as roles_router
from app.api.settings import router as settings_router, MODEL_CATALOG
from app.api.diagnostics import router as diagnostics_router
from app.api.updates import router as updates_router
from app.api.monitoring import router as monitoring_router
from app.core.config import settings
from app.core.security import verify_api_key
from app.db.models import AppSetting, AuditLog, Camera, RetrainJob
from app.models.detector import detector
from app.core.config import PROJECT_ROOT
from app.db.session import Base, SessionLocal, engine
from sqlalchemy import inspect, text
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
        _ensure_compatibility_columns()
        saved_model = db.get(AppSetting, "base_model")
        from app.api import settings as settings_api
        from app.services.incident_recording import RecordingSettings
        recording = db.get(AppSetting, "incident_recording")
        settings_api.recording_settings = RecordingSettings.model_validate_json(recording.value) if recording else RecordingSettings()
        stream_manager.configure_recording(settings_api.recording_settings)
        if saved_model and saved_model.value in {e["filename"] for e in MODEL_CATALOG.values()}:
            target = PROJECT_ROOT / "ml" / "models" / saved_model.value
            if target.is_file():
                detector.select_base_model(target)
        thresholds = db.get(AppSetting, "detection_thresholds")
        if thresholds:
            try:
                values = __import__("json").loads(thresholds.value)
                settings.CONFIDENCE_THRESHOLD = float(values.get("confidence", settings.CONFIDENCE_THRESHOLD))
                settings.WEAPON_CONFIDENCE_THRESHOLD = float(values.get("weapon_confidence", settings.WEAPON_CONFIDENCE_THRESHOLD))
                settings.CUSTOM_CONFIDENCE_THRESHOLD = float(values.get("custom_confidence", settings.CUSTOM_CONFIDENCE_THRESHOLD))
            except (TypeError, ValueError, KeyError):
                pass
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
            stream_manager.start_camera(cam.id, cam.name, cam.rtsp_url, is_active=cam.is_active, target_fps=cam.target_fps, jpeg_quality=cam.jpeg_quality, detect_every=cam.detect_every)
    finally:
        db.close()


def _ensure_compatibility_columns() -> None:
    """Small SQLite/PostgreSQL migration for installations created before review workflow."""
    inspector = inspect(engine)
    if "cameras" in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns("cameras")}
        with engine.begin() as connection:
            for name, default in {"target_fps": 12, "jpeg_quality": 82, "detect_every": 3}.items():
                if name not in columns:
                    connection.execute(text(f"ALTER TABLE cameras ADD COLUMN {name} INTEGER NOT NULL DEFAULT {default}"))
    if "violations" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("violations")}
    additions = {
        "review_status": "VARCHAR(24) NOT NULL DEFAULT 'new'",
        "review_comment": "TEXT NOT NULL DEFAULT ''",
        "reviewed_by": "VARCHAR(120)",
        "reviewed_at": "TIMESTAMP",
    }
    with engine.begin() as connection:
        for name, definition in additions.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE violations ADD COLUMN {name} {definition}"))
    if "employees" in inspector.get_table_names():
        existing = {column["name"] for column in inspector.get_columns("employees")}
        with engine.begin() as connection:
            for name, definition in {"totp_secret": "VARCHAR(64)", "totp_enabled": "BOOLEAN NOT NULL DEFAULT FALSE", "totp_pending_secret": "VARCHAR(64)", "totp_pending_expires": "INTEGER", "totp_last_counter": "INTEGER"}.items():
                if name not in existing:
                    connection.execute(text(f"ALTER TABLE employees ADD COLUMN {name} {definition}"))


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
app.include_router(monitoring_router)


@app.middleware("http")
async def audit_mutating_requests(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/") and request.method not in {"GET", "HEAD", "OPTIONS"} and request.url.path != "/api/auth/login":
        principal = getattr(request.state, "principal", None) or {"id": None, "username": "anonymous"}
        try:
            with SessionLocal() as db:
                db.add(AuditLog(
                    employee_id=principal.get("id"),
                    username=principal.get("username", "anonymous"),
                    action=request.url.path.rsplit("/", 1)[-1] or request.method.lower(),
                    method=request.method,
                    path=request.url.path[:256],
                    status_code=response.status_code,
                    ip_address=request.client.host if request.client else None,
                ))
                db.commit()
        except Exception:
            # Auditing must never make a camera or acknowledgement request fail.
            pass
    return response

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
app.include_router(roles_router)
app.include_router(settings_router)
app.include_router(diagnostics_router)
app.include_router(updates_router)


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
