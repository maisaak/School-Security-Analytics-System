from __future__ import annotations

import json

from app.db.models import User


def camera_scope_ids(user: User | None) -> set[int] | None:
    """Пустой список означает «все камеры». Непустой — явное ограничение по ID."""
    if user is None:
        return None
    try:
        raw = json.loads(user.camera_scope_json or "[]")
    except (TypeError, ValueError):
        return None
    if not isinstance(raw, list):
        return None
    ids = {int(value) for value in raw if str(value).lstrip("-").isdigit()}
    return ids or None


def can_access_camera(user: User | None, camera_id: int) -> bool:
    scope = camera_scope_ids(user)
    return scope is None or int(camera_id) in scope


def sanitize_scope(raw: list[int] | None) -> list[int]:
    if not raw:
        return []
    return sorted({int(value) for value in raw if isinstance(value, (int, str)) and str(value).lstrip("-").isdigit()})
