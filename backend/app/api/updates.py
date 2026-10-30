"""Admin-only control plane. Deployment is performed by a separate systemd worker."""
from __future__ import annotations

import json
import subprocess
import urllib.request
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.config import PROJECT_ROOT, settings
from app.core.security import verify_api_key
from fastapi import Request


def update_admin(request: Request, _: None = Depends(verify_api_key)):
    # Deliberately stricter than model/employee-management permissions.
    if request.state.principal["role"] != "admin":
        raise HTTPException(403, "Обновлять сервер может только администратор")


router = APIRouter(prefix="/api/system/updates", dependencies=[Depends(update_admin)], tags=["updates"])
REPOSITORY = "maisaak/School-Security-Analytics-System"


def current_commit() -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=5, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


def state_dir() -> Path:
    if not settings.SERVER_UPDATES_ENABLED:
        raise HTTPException(409, "Механизм обновления не установлен. См. docs/SERVER_UPDATES.md")
    path = settings.SERVER_UPDATE_STATE_DIR
    if not path.is_dir():
        raise HTTPException(503, "Каталог службы обновления недоступен")
    return path


@router.get("")
def status():
    path = settings.SERVER_UPDATE_STATE_DIR
    job = {"status": "idle"}
    try:
        job = json.loads((path / "status.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    return {"enabled": settings.SERVER_UPDATES_ENABLED, "repository": REPOSITORY, "branch": "main", "current": current_commit(), "auto_update": (path / "auto-enabled").exists() if settings.SERVER_UPDATES_ENABLED else False, "pending": (path / "request").exists() if settings.SERVER_UPDATES_ENABLED else False, "job": job}


@router.post("/check")
def check():
    try:
        request = urllib.request.Request(f"https://api.github.com/repos/{REPOSITORY}/commits/main", headers={"Accept": "application/vnd.github+json", "User-Agent": "School-Security-Updater"})
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.loads(response.read(1024 * 1024))
        latest = data["sha"]
    except (OSError, ValueError, KeyError) as exc:
        raise HTTPException(502, "Не удалось проверить GitHub. Повторите позже.") from exc
    current = current_commit()
    return {"current": current, "latest": latest, "update_available": current is not None and current != latest}


@router.post("/install", status_code=202)
def install():
    path = state_dir()
    try:
        with (path / "request").open("x", encoding="utf-8") as stream:
            stream.write("main\n")
    except FileExistsError:
        raise HTTPException(409, "Запрос обновления уже ожидает выполнения")
    except OSError as exc:
        raise HTTPException(503, "Не удалось передать запрос службе обновления") from exc
    return {"queued": True}


class AutoUpdate(BaseModel):
    enabled: bool


@router.put("/auto")
def automatic(payload: AutoUpdate):
    path = state_dir()
    try:
        if payload.enabled:
            (path / "auto-enabled").touch()
        else:
            (path / "auto-enabled").unlink(missing_ok=True)
    except OSError as exc:
        raise HTTPException(503, "Не удалось изменить автоматическое обновление") from exc
    return {"auto_update": payload.enabled}
