"""Shared archive boundaries for listing and every export format."""
from datetime import datetime, timezone

from fastapi import HTTPException, Query
from app.db.models import Violation


def archive_filters(violation_type: str | None = None, camera_id: int | None = None,
                    review_status: str | None = None, unacknowledged_only: bool = False,
                    date_from: datetime | None = None, date_to: datetime | None = None,
                    min_confidence: float | None = Query(None, ge=0, le=1), ids: str | None = Query(None, max_length=2400)) -> dict:
    if review_status and review_status not in {"new", "in_review", "confirmed", "false_alarm", "closed"}:
        raise HTTPException(422, "Неизвестный статус проверки")
    for value in (date_from, date_to):
        if value is not None and value.tzinfo is None:
            raise HTTPException(422, "Укажите часовой пояс даты архива")
    if date_from and date_to and date_from >= date_to:
        raise HTTPException(422, "Начало периода должно быть раньше конца")
    selected = None
    if ids is not None:
        try:
            selected = {int(item) for item in ids.split(",")}
            if not selected or len(selected) > 100 or any(item <= 0 for item in selected):
                raise ValueError()
        except ValueError:
            raise HTTPException(422, "Выберите от 1 до 100 событий")
    return dict(violation_type=violation_type, camera_id=camera_id, review_status=review_status,
                unacknowledged_only=unacknowledged_only, date_from=date_from, date_to=date_to,
                min_confidence=min_confidence, ids=selected)


def apply_archive_filters(query, filters: dict):
    for key in ("violation_type", "camera_id", "review_status"):
        if filters[key] is not None and filters[key] != "":
            query = query.filter(getattr(Violation, key) == filters[key])
    if filters["unacknowledged_only"]:
        query = query.filter(Violation.is_acknowledged.is_(False))
    # Existing timestamps are stored as UTC without tzinfo by SQLite.
    if filters["date_from"]:
        query = query.filter(Violation.detected_at >= filters["date_from"].astimezone(timezone.utc).replace(tzinfo=None))
    if filters["date_to"]:
        query = query.filter(Violation.detected_at < filters["date_to"].astimezone(timezone.utc).replace(tzinfo=None))
    if filters["min_confidence"] is not None:
        query = query.filter(Violation.confidence >= filters["min_confidence"])
    if filters["ids"] is not None:
        query = query.filter(Violation.id.in_(filters["ids"]))
    return query


def csv_cell(value):
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + value
    return value
