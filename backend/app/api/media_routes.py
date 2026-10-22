from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.core.auth import get_current_user
from app.core.config import settings
from app.db.models import User

router = APIRouter(tags=["Media"])

ALLOWED_MEDIA_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".webm", ".mov", ".avi", ".mkv"}


@router.get("/media/{file_path:path}")
def serve_media(
    file_path: str,
    download: bool = False,
    _: User = Depends(get_current_user),
):
    """
    Защищённая отдача улик. Публичный StaticFiles-маунт убран: без действующей сессии
    (HttpOnly cookie) фото и видео инцидентов недоступны, включая прямые ссылки.
    """
    media_root = settings.MEDIA_ROOT.resolve()
    try:
        target = (media_root / file_path).resolve()
        target.relative_to(media_root)
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Недопустимый путь к медиафайлу") from exc

    if not target.is_file():
        raise HTTPException(status_code=404, detail="Файл не найден")
    if target.suffix.lower() not in ALLOWED_MEDIA_SUFFIXES:
        raise HTTPException(status_code=415, detail="Тип файла не поддерживается")

    media_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return FileResponse(
        path=str(target),
        media_type=media_type,
        filename=Path(target.name).name if download else None,
        headers={"Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff"},
    )
