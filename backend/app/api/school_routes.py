from __future__ import annotations

import csv
import io
import random
from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from sqlalchemy.orm import Session

from app.api.schemas import AccessEventIn, VisitorPassIn
from app.core.auth import require_permissions
from app.core.config import settings
from app.core.permissions import Permission
from app.core.security import read_upload_limited
from app.db.models import AccessEvent, User, VisitorPass
from app.db.session import get_db
from app.services.audit import record_audit
from app.services.event_bus import event_bus

router = APIRouter(prefix="/api", tags=["СКУД и посетители"])

PERSON_KIND_LABELS = {
    "student": "Ученик",
    "teacher": "Учитель",
    "staff": "Сотрудник",
    "visitor": "Посетитель",
}


def _aware(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _start_of_day(day: datetime | None = None) -> datetime:
    moment = _aware(day).astimezone()
    return moment.replace(hour=0, minute=0, second=0, microsecond=0)


def _is_late(moment: datetime, kind: str) -> bool:
    if kind != "student":
        return False
    local = _aware(moment).astimezone()
    hour, minute = (int(part) for part in settings.SCHOOL_START_TIME.split(":"))
    deadline = local.replace(hour=hour, minute=minute + settings.LATE_GRACE_MIN, second=0, microsecond=0)
    return local > deadline


def _serialize_event(row: AccessEvent) -> dict:
    return {
        "id": row.id,
        "occurred_at": _aware(row.occurred_at).isoformat(),
        "person_name": row.person_name,
        "person_kind": row.person_kind,
        "person_kind_label": PERSON_KIND_LABELS.get(row.person_kind, row.person_kind),
        "class_name": row.class_name,
        "turnstile": row.turnstile,
        "direction": row.direction,
        "direction_label": "вход" if row.direction == "in" else "выход",
        "is_late": bool(row.is_late),
        "card_id": row.card_id,
        "source": row.source,
    }


def _serialize_pass(row: VisitorPass) -> dict:
    now = datetime.now(timezone.utc)
    status = row.status
    if status in {"expected", "inside"} and _aware(row.valid_to) < now:
        status = "expired"
    return {
        "id": row.id,
        "full_name": row.full_name,
        "organization": row.organization,
        "purpose": row.purpose,
        "host": row.host,
        "badge_no": row.badge_no,
        "phone": row.phone,
        "valid_from": _aware(row.valid_from).isoformat(),
        "valid_to": _aware(row.valid_to).isoformat(),
        "status": status,
        "checked_in_at": _aware(row.checked_in_at).isoformat() if row.checked_in_at else None,
        "checked_out_at": _aware(row.checked_out_at).isoformat() if row.checked_out_at else None,
        "created_by": row.created_by,
        "notes": row.notes,
        "created_at": _aware(row.created_at).isoformat(),
    }


def _refresh_expired(db: Session) -> None:
    now = datetime.now(timezone.utc)
    changed = False
    for row in db.query(VisitorPass).filter(VisitorPass.status.in_(["expected", "inside"])).all():
        if _aware(row.valid_to) < now and row.status == "expected":
            row.status = "expired"
            changed = True
    if changed:
        db.commit()


@router.get("/access/events")
def list_access_events(
    date: str | None = None,
    direction: str | None = None,
    kind: str | None = None,
    late_only: bool = False,
    search: str | None = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.ACCESS_VIEW)),
):
    day = _start_of_day(datetime.fromisoformat(date) if date else None)
    moment_to = day + timedelta(days=1)
    query = db.query(AccessEvent).filter(AccessEvent.occurred_at >= day, AccessEvent.occurred_at < moment_to)
    if direction in {"in", "out"}:
        query = query.filter(AccessEvent.direction == direction)
    if kind:
        query = query.filter(AccessEvent.person_kind == kind)
    if late_only:
        query = query.filter(AccessEvent.is_late.is_(True))
    if search:
        query = query.filter(AccessEvent.person_name.ilike(f"%{search.strip()}%"))
    total = query.count()
    rows = query.order_by(AccessEvent.occurred_at.desc()).offset(max(0, offset)).limit(max(1, min(limit, 500))).all()
    return {
        "date": day.date().isoformat(),
        "total": total,
        "items": [_serialize_event(row) for row in rows],
        "limit": limit,
        "offset": offset,
    }


@router.get("/access/summary")
def access_summary(
    date: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.ACCESS_VIEW)),
):
    day = _start_of_day(datetime.fromisoformat(date) if date else None)
    moment_to = day + timedelta(days=1)
    rows = (
        db.query(AccessEvent)
        .filter(AccessEvent.occurred_at >= day, AccessEvent.occurred_at < moment_to)
        .order_by(AccessEvent.occurred_at.asc())
        .all()
    )
    inside: dict[str, int] = {}
    by_kind: Counter[str] = Counter()
    hourly = [0] * 24
    turnstiles: Counter[str] = Counter()
    for row in rows:
        key = f"{row.person_name}|{row.person_kind}"
        inside[key] = inside.get(key, 0) + (1 if row.direction == "in" else -1)
        by_kind[row.person_kind] += 1
        hourly[_aware(row.occurred_at).astimezone().hour] += 1
        turnstiles[row.turnstile] += 1
    inside_count = sum(max(0, value) for value in inside.values())
    late = [row for row in rows if row.is_late]
    return {
        "date": day.date().isoformat(),
        "events": len(rows),
        "entries": sum(1 for row in rows if row.direction == "in"),
        "exits": sum(1 for row in rows if row.direction == "out"),
        "inside_now": inside_count,
        "late_students": len(late),
        "late_list": [_serialize_event(row) for row in late[:12]],
        "by_kind": dict(by_kind),
        "hourly": hourly,
        "turnstiles": [{"name": name, "count": count} for name, count in turnstiles.most_common(8)],
        "school_start": settings.SCHOOL_START_TIME,
        "late_grace_min": settings.LATE_GRACE_MIN,
    }


@router.post("/access/events", status_code=201)
def create_access_event(
    payload: AccessEventIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.ACCESS_VIEW)),
):
    now = datetime.now(timezone.utc)
    row = AccessEvent(
        occurred_at=now,
        person_name=payload.person_name.strip(),
        person_kind=payload.person_kind,
        class_name=payload.class_name.strip(),
        turnstile=payload.turnstile.strip() or "Главный вход",
        direction=payload.direction,
        is_late=_is_late(now, payload.person_kind),
        card_id=payload.card_id.strip(),
        source="manual",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    record_audit(
        db,
        action="access.event.create",
        request=request,
        user=user,
        entity_type="access_event",
        entity_id=row.id,
        detail={"person": row.person_name, "direction": row.direction, "kind": row.person_kind},
    )
    return _serialize_event(row)


@router.post("/access/import")
async def import_access_events(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.ACCESS_VIEW)),
):
    """Импорт выгрузки турникета (CSV с «;» или «,»): дата, ФИО, тип, класс, направление."""
    content = await read_upload_limited(file, max_bytes=5 * 1024 * 1024)
    text = content.decode("utf-8-sig", errors="replace")
    sample = text.splitlines()[0] if text.splitlines() else ""
    delimiter = ";" if sample.count(";") >= sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    created = 0
    errors: list[str] = []
    for index, item in enumerate(reader, start=2):
        try:
            raw_time = (item.get("occurred_at") or item.get("time") or "").strip()
            moment = datetime.fromisoformat(raw_time.replace("Z", "+00:00")) if raw_time else datetime.now(timezone.utc)
            if moment.tzinfo is None:
                moment = moment.replace(tzinfo=timezone.utc)
            kind = (item.get("person_kind") or item.get("kind") or "student").strip().lower()
            if kind not in PERSON_KIND_LABELS:
                kind = "student"
            direction = (item.get("direction") or "in").strip().lower()
            row = AccessEvent(
                occurred_at=moment,
                person_name=(item.get("person_name") or item.get("name") or "Без имени").strip()[:160],
                person_kind=kind,
                class_name=(item.get("class_name") or item.get("class") or "").strip()[:32],
                turnstile=(item.get("turnstile") or "Главный вход").strip()[:64],
                direction="out" if direction.startswith("out") or direction.startswith("вых") else "in",
                is_late=_is_late(moment, kind),
                card_id=(item.get("card_id") or "").strip()[:64],
                source="import",
            )
            db.add(row)
            created += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"строка {index}: {exc}")
    db.commit()
    record_audit(
        db,
        action="access.import",
        request=request,
        user=user,
        entity_type="access_event",
        detail={"created": created, "errors": len(errors), "filename": file.filename},
    )
    return {"created": created, "errors": errors[:20], "filename": file.filename}


@router.post("/access/simulate")
def simulate_access_events(
    request: Request,
    count: int = Query(default=18, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.ACCESS_VIEW)),
):
    """Демонстрационный поток СКУД: сегодняшние проходы учеников и сотрудников."""
    created = seed_access_events(db, count=count, force=True)
    record_audit(
        db,
        action="access.simulate",
        request=request,
        user=user,
        entity_type="access_event",
        detail={"created": created},
    )
    return {"created": created}


# ─── Гостевые пропуска ──────────────────────────────────────────────────────

@router.get("/visitors")
def list_visitor_passes(
    status: str | None = None,
    date: str | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.VISITORS_MANAGE)),
):
    _refresh_expired(db)
    query = db.query(VisitorPass)
    if status:
        query = query.filter(VisitorPass.status == status)
    if date:
        day = _start_of_day(datetime.fromisoformat(date))
        query = query.filter(VisitorPass.created_at >= day, VisitorPass.created_at < day + timedelta(days=1))
    rows = query.order_by(VisitorPass.created_at.desc()).limit(max(1, min(limit, 300))).all()
    return {"items": [_serialize_pass(row) for row in rows], "total": len(rows)}


@router.get("/visitors/summary")
def visitor_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_permissions(Permission.VISITORS_MANAGE)),
):
    _refresh_expired(db)
    now = datetime.now(timezone.utc)
    rows = db.query(VisitorPass).all()
    today = _start_of_day()
    today_rows = [row for row in rows if _aware(row.created_at) >= today]
    return {
        "total": len(rows),
        "expected_today": sum(1 for row in today_rows if row.status == "expected"),
        "inside": sum(1 for row in rows if row.status == "inside"),
        "left_today": sum(1 for row in today_rows if row.status == "left"),
        "expired": sum(1 for row in rows if row.status == "expired"),
        "overdue": sum(
            1
            for row in rows
            if row.status == "inside" and _aware(row.valid_to) < now
        ),
        "inside_list": [_serialize_pass(row) for row in rows if row.status == "inside"][:20],
    }


def _generate_badge(db: Session) -> str:
    for _ in range(50):
        badge = f"V-{random.randint(1000, 9999)}"
        if not db.query(VisitorPass).filter(VisitorPass.badge_no == badge).first():
            return badge
    return f"V-{int(datetime.now().timestamp()) % 100000}"


@router.post("/visitors", status_code=201)
def create_visitor_pass(
    payload: VisitorPassIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.VISITORS_MANAGE)),
):
    now = datetime.now(timezone.utc)
    row = VisitorPass(
        full_name=payload.full_name.strip(),
        organization=payload.organization.strip(),
        purpose=payload.purpose.strip(),
        host=payload.host.strip(),
        phone=payload.phone.strip(),
        badge_no=_generate_badge(db),
        valid_from=now,
        valid_to=now + timedelta(hours=payload.valid_hours),
        status="expected",
        created_by=user.username,
        notes=payload.notes.strip(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    record_audit(
        db,
        action="visitor.create",
        request=request,
        user=user,
        entity_type="visitor_pass",
        entity_id=row.id,
        detail={"full_name": row.full_name, "badge_no": row.badge_no, "host": row.host},
    )
    event_bus.publish("visitor.created", {"id": row.id, "full_name": row.full_name, "badge_no": row.badge_no})
    return _serialize_pass(row)


def _pass_or_404(db: Session, pass_id: int) -> VisitorPass:
    row = db.query(VisitorPass).filter(VisitorPass.id == pass_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Пропуск не найден")
    return row


@router.post("/visitors/{pass_id}/check-in")
def check_in_visitor(
    pass_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.VISITORS_MANAGE)),
):
    row = _pass_or_404(db, pass_id)
    if row.status == "inside":
        raise HTTPException(status_code=409, detail="Посетитель уже внутри")
    if row.status in {"cancelled", "expired"}:
        raise HTTPException(status_code=400, detail="Пропуск недействителен")
    now = datetime.now(timezone.utc)
    row.status = "inside"
    row.checked_in_at = now
    row.checked_out_at = None
    db.add(
        AccessEvent(
            occurred_at=now,
            person_name=row.full_name,
            person_kind="visitor",
            turnstile="Пост охраны",
            direction="in",
            card_id=row.badge_no,
            source="manual",
        )
    )
    db.commit()
    db.refresh(row)
    record_audit(
        db,
        action="visitor.check_in",
        request=request,
        user=user,
        entity_type="visitor_pass",
        entity_id=row.id,
        detail={"full_name": row.full_name, "badge_no": row.badge_no},
    )
    event_bus.publish("visitor.check_in", {"id": row.id, "full_name": row.full_name})
    return _serialize_pass(row)


@router.post("/visitors/{pass_id}/check-out")
def check_out_visitor(
    pass_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.VISITORS_MANAGE)),
):
    row = _pass_or_404(db, pass_id)
    now = datetime.now(timezone.utc)
    row.status = "left"
    row.checked_out_at = now
    db.add(
        AccessEvent(
            occurred_at=now,
            person_name=row.full_name,
            person_kind="visitor",
            turnstile="Пост охраны",
            direction="out",
            card_id=row.badge_no,
            source="manual",
        )
    )
    db.commit()
    db.refresh(row)
    record_audit(
        db,
        action="visitor.check_out",
        request=request,
        user=user,
        entity_type="visitor_pass",
        entity_id=row.id,
        detail={
            "full_name": row.full_name,
            "badge_no": row.badge_no,
            "visited_sec": round((now - _aware(row.checked_in_at)).total_seconds(), 1) if row.checked_in_at else None,
        },
    )
    return _serialize_pass(row)


@router.post("/visitors/{pass_id}/cancel")
def cancel_visitor_pass(
    pass_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.VISITORS_MANAGE)),
):
    row = _pass_or_404(db, pass_id)
    row.status = "cancelled"
    db.commit()
    record_audit(
        db,
        action="visitor.cancel",
        request=request,
        user=user,
        entity_type="visitor_pass",
        entity_id=row.id,
        detail={"full_name": row.full_name},
    )
    return _serialize_pass(row)


@router.delete("/visitors/{pass_id}", status_code=204)
def delete_visitor_pass(
    pass_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permissions(Permission.VISITORS_MANAGE)),
):
    row = _pass_or_404(db, pass_id)
    db.delete(row)
    db.commit()
    record_audit(
        db,
        action="visitor.delete",
        request=request,
        user=user,
        entity_type="visitor_pass",
        entity_id=pass_id,
        detail={"full_name": row.full_name},
    )
    return None


# ─── Демоданные СКУД ────────────────────────────────────────────────────────

DEMO_PEOPLE = [
    ("Иванова Мария", "student", "9А"),
    ("Петров Артём", "student", "9Б"),
    ("Смирнов Даниил", "student", "7В"),
    ("Кузнецова Алиса", "student", "8А"),
    ("Волков Егор", "student", "10А"),
    ("Соколова Вера", "student", "6Б"),
    ("Морозов Илья", "student", "11А"),
    ("Фёдорова Дарья", "student", "8В"),
    ("Ковалёв Андрей", "teacher", "Информатика"),
    ("Смирнова Елена", "staff", "Администрация"),
    ("Ибрагимов Руслан", "staff", "Охрана"),
    ("Лебедева Ольга", "teacher", "Русский язык"),
]


def seed_access_events(db: Session, count: int = 18, force: bool = False) -> int:
    """Создаёт демонстрационные проходы за сегодня. force=False — только если журнал пуст."""
    today = _start_of_day()
    if not force and db.query(AccessEvent).filter(AccessEvent.occurred_at >= today).count() > 0:
        return 0
    rnd = random.Random(42)
    base = today.replace(hour=7, minute=40)
    created = 0
    for index in range(count):
        name, kind, extra = DEMO_PEOPLE[index % len(DEMO_PEOPLE)]
        moment = base + timedelta(minutes=rnd.randint(0, 95), seconds=rnd.randint(0, 59))
        if moment > datetime.now(timezone.utc):
            moment = datetime.now(timezone.utc) - timedelta(minutes=rnd.randint(1, 40))
        direction = "in" if index % 5 else "out"
        db.add(
            AccessEvent(
                occurred_at=moment,
                person_name=name,
                person_kind=kind,
                class_name="" if kind in {"staff", "teacher"} else extra,
                turnstile="Главный вход" if index % 3 else "Калитка №2",
                direction=direction,
                is_late=_is_late(moment, kind),
                card_id=f"CARD-{1000 + index}",
                source="turnstile",
            )
        )
        created += 1
    db.commit()
    return created
