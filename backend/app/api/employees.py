from __future__ import annotations

from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.accounts import hash_password, revoke_sessions
from app.core.security import require_admin
from app.db.models import Employee
from app.db.session import get_db

router = APIRouter(prefix="/api/employees", dependencies=[Depends(require_admin)], tags=["employees"])


class EmployeeCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=False, extra="forbid")
    username: str = Field(pattern=r"^[a-z0-9][a-z0-9_.-]{2,63}$")
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=256)
    role: Literal["admin", "operator", "viewer"] = "viewer"


class EmployeeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    password: str | None = Field(default=None, min_length=12, max_length=256)
    role: Literal["admin", "operator", "viewer"] | None = None
    is_active: bool | None = None


def serialize(user: Employee) -> dict:
    return {"id": user.id, "username": user.username, "display_name": user.display_name, "role": user.role, "is_active": user.is_active, "created_at": user.created_at}


@router.get("")
def list_employees(db: Session = Depends(get_db)):
    return [serialize(u) for u in db.query(Employee).order_by(Employee.id).all()]


@router.post("", status_code=201)
def create_employee(payload: EmployeeCreate, db: Session = Depends(get_db)):
    if not payload.display_name.strip():
        raise HTTPException(status_code=422, detail="Укажите имя сотрудника")
    user = Employee(username=payload.username, display_name=payload.display_name.strip(), password_hash=hash_password(payload.password), role=payload.role)
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Этот логин уже занят") from exc
    return serialize(user)


@router.patch("/{employee_id}")
def update_employee(employee_id: int, payload: EmployeeUpdate, request: Request, db: Session = Depends(get_db)):
    user = db.get(Employee, employee_id)
    if not user:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    if request.state.principal["id"] == employee_id and (payload.is_active is False or payload.role not in {None, "admin"}):
        raise HTTPException(status_code=409, detail="Нельзя отключить или понизить собственный доступ")
    if payload.display_name is not None:
        if not payload.display_name.strip():
            raise HTTPException(status_code=422, detail="Укажите имя")
        user.display_name = payload.display_name.strip()
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    revoke_sessions(db, employee_id)
    db.commit()
    return serialize(user)
