from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app.api import admin_routes, auth_routes, media_routes, model_routes, routes
from app.core.config import settings
from app.core.security import hash_password, verify_api_key
from app.db.models import Camera, ModelVersion, RetrainJob, User
from app.db.session import SessionLocal, ensure_schema
from app.services.model_registry import ensure_baseline_version
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

# Демо-учётки с быстрым входом со страницы логина (v2)
DEFAULT_USERS = [
    {
        "username": settings.DEMO_ADMIN_USERNAME,
        "password": settings.DEMO_ADMIN_PASSWORD,
        "role": "admin",
        "full_name": "Смирнова Елена Викторовна",
    },
    {
        "username": settings.DEMO_DIRECTOR_USERNAME,
        "password": settings.DEMO_DIRECTOR_PASSWORD,
        "role": "director",
        "full_name": "Ковалёв Андрей Петрович",
    },
    {
        "username": settings.DEMO_GUARD_USERNAME,
        "password": settings.DEMO_GUARD_PASSWORD,
        "role": "guard",
        "full_name": "Ибрагимов Руслан Тимурович",
    },
]

DEMO_BASELINE_METRICS = {
    "metrics/precision(B)": 0.9274,
    "metrics/recall(B)": 0.8938,
    "metrics/mAP50(B)": 0.9772,
    "metrics/mAP50-95(B)": 0.8095,
    "box_loss": 0.7999,
    "cls_loss": 1.6290,
}


def _seed_users(db) -> None:
    for item in DEFAULT_USERS:
        existing = db.query(User).filter(User.username == item["username"]).first()
        if existing is None:
            db.add(
                User(
                    username=item["username"],
                    full_name=item["full_name"],
                    role=item["role"],
                    password_hash=hash_password(item["password"]),
                    is_active=True,
                    is_demo=True,
                )
            )
    db.commit()


def _seed_initial_state() -> None:
    db = SessionLocal()
    try:
        if db.query(Camera).count() == 0:
            for item in DEFAULT_CAMERAS:
                db.add(Camera(**item, is_active=True))
            db.commit()

        _seed_users(db)

        if db.query(RetrainJob).count() == 0:
            db.add(
                RetrainJob(
                    status="completed",
                    epochs=8,
                    current_epoch=8,
                    dataset_yaml="ml/datasets/school_security.yaml",
                    metrics_json=json.dumps(DEMO_BASELINE_METRICS),
                    details="Базовые дообученные веса school_security_best.pt активны · mAP@50 = 97.7%",
                    validation_passed=True,
                    final_map50=DEMO_BASELINE_METRICS["metrics/mAP50(B)"],
                    completed_at=datetime.now(timezone.utc),
                )
            )
            db.commit()

        # Реестр версий: текущие боевые веса становятся baseline-версией с возможностью отката
        if db.query(ModelVersion).count() == 0:
            ensure_baseline_version(db, metrics=DEMO_BASELINE_METRICS)

        for cam in db.query(Camera).all():
            stream_manager.start_camera(cam.id, cam.name, cam.rtsp_url, is_active=cam.is_active)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_schema()
    _seed_initial_state()
    yield
    stream_manager.stop_all()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.APP_VERSION,
    description=(
        "Система видеомониторинга школьной безопасности YOLOv8. "
        "v2: JWT + HttpOnly cookie, RBAC (admin/director/guard), ByteTrack-трекинг с таймером "
        "выдержки бесхозной сумки, Validation Gate и реестр версий весов с откатом, "
        "маскирование RTSP-кредов и полный журнал аудита."
    ),
    lifespan=lifespan,
)

wildcard_cors = "*" in settings.CORS_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=not wildcard_cors,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    if request.url.path.startswith("/api/auth") or request.url.path.startswith("/media"):
        response.headers["Cache-Control"] = "no-store"
    return response


# Публичные (без cookie) маршруты аутентификации + защищённые API-модули
app.include_router(auth_routes.router, dependencies=[Depends(verify_api_key)])
app.include_router(routes.router, dependencies=[Depends(verify_api_key)])
app.include_router(model_routes.router, dependencies=[Depends(verify_api_key)])
app.include_router(admin_routes.router, dependencies=[Depends(verify_api_key)])
app.include_router(media_routes.router)


@app.get("/", include_in_schema=False)
def root_redirect():
    return RedirectResponse(url="/docs")


@app.get("/health")
def healthcheck():
    return {
        "status": "ok",
        "service": settings.PROJECT_NAME,
        "version": settings.APP_VERSION,
        "auth": "jwt-cookie",
    }
