from __future__ import annotations

import statistics
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.api.serializers import serialize_violation
from app.core.access import camera_scope_ids
from app.core.auth import require_permissions
from app.core.config import settings
from app.core.permissions import Permission
from app.db.models import Camera, User, Violation
from app.db.session import get_db
from app.services.audit import record_audit
from app.services.reports import build_excel, build_pdf, summary_for_rows

router = APIRouter(prefix="/api/analytics", tags=["Аналитика, SLA и отчёты"])

UNACK_LABEL = "ожидает"


def _aware(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        try:
            moment = datetime.strptime(text, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Некорректная дата: {value}") from None
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment


def _scoped_rows(
    db: Session,
    user: User,
    *,
    days: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    camera_id: int | None = None,
    violation_type: str | None = None,
    include_false_alarm: bool = True,
) -> list[Violation]:
    query = db.query(Violation).outerjoin(Camera)
    scope = camera_scope_ids(user)
    if scope is not None:
        query = query.filter(Violation.camera_id.in_(sorted(scope)))
    moment_from = _parse(date_from) or (datetime.now(timezone.utc) - timedelta(days=days or 7) if days else None)
    moment_to = _parse(date_to)
    if date_to and len(date_to.strip()) == 10 and moment_to:
        moment_to = moment_to + timedelta(days=1)
    if moment_from:
        query = query.filter(Violation.detected_at >= moment_from)
    if moment_to:
        query = query.filter(Violation.detected_at < moment_to)
    if camera_id:
        query = query.filter(Violation.camera_id == camera_id)
    if violation_type:
        query = query.filter(Violation.violation_type == violation_type)
    if not include_false_alarm:
        query = query.filter(Violation.is_false_alarm.is_(False))
    return query.order_by(Violation.detected_at.desc()).all()


# ─── SLA реакции охраны ─────────────────────────────────────────────────────

@router.get("/sla")
def sla_report(
    days: int = Query(default=7, ge=1, le=365),
    camera_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.VIOLATIONS_VIEW)),
):
    rows = _scoped_rows(db, user, days=days, camera_id=camera_id)
    measured = [row for row in rows if row.acknowledged_latency_sec is not None]
    values = [float(row.acknowledged_latency_sec) for row in measured]
    now = datetime.now(timezone.utc)

    overdue = [
        {
            "id": row.id,
            "camera_name": row.camera.name if row.camera else f"Камера #{row.camera_id}",
            "violation_type": row.violation_type,
            "detected_at": _aware(row.detected_at).isoformat(),
            "latency_sec": round(float(row.acknowledged_latency_sec), 1),
            "acknowledged_by": row.acknowledged_by,
        }
        for row in measured
        if float(row.acknowledged_latency_sec) > settings.SLA_TARGET_SEC
    ][:50]

    by_guard: dict[str, list[float]] = defaultdict(list)
    for row in measured:
        if row.acknowledged_by:
            by_guard[row.acknowledged_by].append(float(row.acknowledged_latency_sec))

    shifts = {
        "day": {"label": "Дневная смена (08:00–20:00)", "count": 0, "latencies": []},
        "night": {"label": "Ночная смена (20:00–08:00)", "count": 0, "latencies": []},
    }
    for row in measured:
        hour = _aware(row.detected_at).astimezone().hour
        key = "day" if 8 <= hour < 20 else "night"
        shifts[key]["count"] += 1
        shifts[key]["latencies"].append(float(row.acknowledged_latency_sec))

    def _aggregate(items: list[float]) -> dict:
        return {
            "avg": round(statistics.mean(items), 1) if items else None,
            "median": round(statistics.median(items), 1) if items else None,
            "p95": round(sorted(items)[max(0, int(len(items) * 0.95) - 1)], 1) if items else None,
        }

    pending = [row for row in rows if not row.is_acknowledged]
    pending_oldest = max(
        ((now - _aware(row.detected_at)).total_seconds() for row in pending),
        default=0.0,
    )

    return {
        "period_days": days,
        "target_sec": settings.SLA_TARGET_SEC,
        "total": len(rows),
        "measured": len(measured),
        "pending": len(pending),
        "pending_oldest_sec": round(pending_oldest, 1),
        "avg_latency_sec": _aggregate(values)["avg"],
        "median_latency_sec": _aggregate(values)["median"],
        "p95_latency_sec": _aggregate(values)["p95"],
        "overdue_count": len(overdue),
        "overdue": overdue,
        "by_guard": [
            {
                "guard": guard,
                "count": len(items),
                "avg_sec": round(statistics.mean(items), 1),
                "median_sec": round(statistics.median(items), 1),
                "overdue": sum(1 for value in items if value > settings.SLA_TARGET_SEC),
            }
            for guard, items in sorted(by_guard.items(), key=lambda item: statistics.mean(item[1]))
        ],
        "by_shift": {
            key: {
                "label": data["label"],
                "count": data["count"],
                **_aggregate(data["latencies"]),
                "overdue": sum(1 for value in data["latencies"] if value > settings.SLA_TARGET_SEC),
            }
            for key, data in shifts.items()
        },
    }


# ─── Теплокарта и качество детекции ────────────────────────────────────────

@router.get("/heatmap")
def heatmap(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.ANALYTICS_VIEW)),
):
    rows = _scoped_rows(db, user, days=days)
    matrix = [[0 for _ in range(24)] for _ in range(7)]
    by_type = Counter()
    by_camera: Counter[str] = Counter()
    false_by_camera: Counter[str] = Counter()
    for row in rows:
        moment = _aware(row.detected_at).astimezone()
        matrix[moment.weekday()][moment.hour] += 1
        by_type[row.violation_type] += 1
        camera_name = row.camera.name if row.camera else f"Камера #{row.camera_id}"
        by_camera[camera_name] += 1
        if row.is_false_alarm:
            false_by_camera[camera_name] += 1

    false_total = sum(false_by_camera.values())
    top_false = [
        {
            "camera": name,
            "false_alarms": count,
            "total": by_camera.get(name, 0),
            "rate": round(count / max(1, by_camera.get(name, 0)) * 100, 1),
        }
        for name, count in false_by_camera.most_common(8)
    ]
    return {
        "period_days": days,
        "weekday_labels": ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
        "hours": list(range(24)),
        "matrix": matrix,
        "max_value": max((max(row) for row in matrix), default=0),
        "by_type": dict(by_type),
        "top_cameras": [{"camera": name, "count": count} for name, count in by_camera.most_common(8)],
        "false_alarm_total": false_total,
        "false_alarm_rate": round(false_total / max(1, len(rows)) * 100, 1),
        "top_false_alarm_cameras": top_false,
    }


@router.get("/ab")
def ab_stats(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.ANALYTICS_VIEW)),
):
    rows = _scoped_rows(db, user, days=days)
    variants: dict[str, list[Violation]] = defaultdict(list)
    for row in rows:
        variants[row.model_variant or "A"].append(row)

    result = []
    for variant, items in sorted(variants.items()):
        confidences = [row.confidence for row in items]
        latencies = [float(row.acknowledged_latency_sec) for row in items if row.acknowledged_latency_sec is not None]
        result.append(
            {
                "variant": variant,
                "count": len(items),
                "avg_confidence": round(statistics.mean(confidences), 4) if confidences else None,
                "false_alarms": sum(1 for row in items if row.is_false_alarm),
                "acknowledged": sum(1 for row in items if row.is_acknowledged),
                "avg_latency_sec": round(statistics.mean(latencies), 1) if latencies else None,
            }
        )
    cameras = [
        {
            "camera_id": cam.id,
            "camera_name": cam.name,
            "profile_a": cam.detector_profile,
            "profile_b": cam.ab_profile,
            "share_b": cam.ab_share_pct,
        }
        for cam in db.query(Camera).filter(Camera.ab_profile.isnot(None)).all()
    ]
    return {"period_days": days, "variants": result, "cameras": cameras}


@router.get("/quality")
def detection_quality(
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.ANALYTICS_VIEW)),
):
    rows = _scoped_rows(db, user, days=days)
    total = len(rows)
    false_total = sum(1 for row in rows if row.is_false_alarm)
    acknowledged = sum(1 for row in rows if row.is_acknowledged)
    confidences = [row.confidence for row in rows]
    return {
        "period_days": days,
        "total": total,
        "false_alarms": false_total,
        "false_alarm_rate": round(false_total / max(1, total) * 100, 1),
        "acknowledged": acknowledged,
        "ack_rate": round(acknowledged / max(1, total) * 100, 1),
        "avg_confidence": round(statistics.mean(confidences), 4) if confidences else None,
        "median_confidence": round(statistics.median(confidences), 4) if confidences else None,
    }


# ─── PDF / Excel отчёты ─────────────────────────────────────────────────────

def _report_rows(
    db: Session,
    user: User,
    date_from: str | None,
    date_to: str | None,
    camera_id: int | None,
    violation_type: str | None,
    include_false_alarm: bool,
) -> tuple[list[Violation], str]:
    if not date_from and not date_to:
        date_from = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
    rows = _scoped_rows(
        db,
        user,
        date_from=date_from,
        date_to=date_to,
        camera_id=camera_id,
        violation_type=violation_type,
        include_false_alarm=include_false_alarm,
    )
    label = f"{date_from or 'начало'} — {date_to or 'сегодня'}"
    return rows, label


@router.get("/reports/incidents.pdf")
def incidents_report_pdf(
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
    camera_id: int | None = None,
    violation_type: str | None = None,
    include_false_alarm: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.REPORTS_EXPORT)),
):
    rows, label = _report_rows(db, user, date_from, date_to, camera_id, violation_type, include_false_alarm)
    content = build_pdf(rows, user.username, label, {"camera_id": camera_id, "violation_type": violation_type})
    record_audit(
        db,
        action="report.download",
        request=request,
        user=user,
        entity_type="report",
        detail={
            "format": "pdf",
            "rows": len(rows),
            "period": label,
            "watermark": True,
        },
    )
    filename = f"incidents_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


@router.get("/reports/incidents.xlsx")
def incidents_report_excel(
    request: Request,
    date_from: str | None = None,
    date_to: str | None = None,
    camera_id: int | None = None,
    violation_type: str | None = None,
    include_false_alarm: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.REPORTS_EXPORT)),
):
    rows, label = _report_rows(db, user, date_from, date_to, camera_id, violation_type, include_false_alarm)
    content = build_excel(rows, user.username, label)
    record_audit(
        db,
        action="report.download",
        request=request,
        user=user,
        entity_type="report",
        detail={"format": "xlsx", "rows": len(rows), "period": label, "watermark": True},
    )
    filename = f"incidents_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


@router.get("/reports/sla.pdf")
def sla_report_pdf(
    request: Request,
    days: int = Query(default=7, ge=1, le=365),
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.REPORTS_EXPORT)),
):
    rows = _scoped_rows(db, user, days=days)
    label = f"последние {days} дн."
    content = build_pdf(rows, user.username, f"SLA реакции охраны · {label}", {"sla_only": True})
    record_audit(
        db,
        action="report.download",
        request=request,
        user=user,
        entity_type="report",
        detail={"format": "pdf", "kind": "sla", "days": days, "rows": len(rows)},
    )
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="sla_report.pdf"', "Cache-Control": "no-store"},
    )


@router.get("/reports/preview")
def report_preview(
    date_from: str | None = None,
    date_to: str | None = None,
    camera_id: int | None = None,
    violation_type: str | None = None,
    include_false_alarm: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.REPORTS_EXPORT)),
):
    rows, label = _report_rows(db, user, date_from, date_to, camera_id, violation_type, include_false_alarm)
    summary = summary_for_rows(rows)
    return {
        "period": label,
        "summary": summary,
        "sample": [serialize_violation(row) for row in rows[:10]],
        "watermark": f"Лицей №6 «Перспектива» · {user.username}",
    }
