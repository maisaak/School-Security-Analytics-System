from __future__ import annotations

import json

from app.db.models import Camera, CameraZone


def parse_json(raw: str | None, default):
    try:
        value = json.loads(raw or "")
    except (TypeError, ValueError):
        return default
    return value if isinstance(value, type(default)) else default


def serialize_zone(zone: CameraZone) -> dict:
    return {
        "id": zone.id,
        "camera_id": zone.camera_id,
        "name": zone.name,
        "kind": zone.kind,
        "color": zone.color,
        "points": parse_json(zone.points_json, []),
    }


def build_camera_policy(camera: Camera) -> dict:
    """Политика аналитики камеры в формате, который понимает CameraWorker."""
    return {
        "zones": [
            {
                "name": zone.name,
                "kind": zone.kind,
                "points": parse_json(zone.points_json, []),
            }
            for zone in (camera.zones or [])
        ],
        "confidence_threshold": camera.confidence_threshold,
        "schedule": parse_json(camera.schedule_json, {}),
        "ab_profile": camera.ab_profile,
        "ab_share_pct": camera.ab_share_pct or 0,
    }
