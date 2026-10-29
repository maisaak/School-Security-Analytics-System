import json
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.core.roles import PERMISSIONS, PREFIX, SYSTEM_ROLES, get_role
from app.core.security import require_admin
from app.db.models import AppSetting, Employee
from app.db.session import get_db

router = APIRouter(prefix="/api/roles", dependencies=[Depends(require_admin)], tags=["roles"])


class RolePayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=240)
    permissions: list[str] = Field(default_factory=list, max_length=len(PERMISSIONS))

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, values):
        if any(value not in PERMISSIONS for value in values):
            raise ValueError("Неизвестное разрешение")
        return list(dict.fromkeys(values))


@router.get("")
def list_roles(db: Session = Depends(get_db)):
    custom = db.query(AppSetting).filter(AppSetting.key.startswith(PREFIX)).order_by(AppSetting.key).all()
    return [get_role(db, key) for key in SYSTEM_ROLES] + [get_role(db, row.key[len(PREFIX):]) for row in custom]


@router.post("", status_code=201)
def create_role(payload: RolePayload, db: Session = Depends(get_db)):
    if any(role["name"].casefold() == payload.name.casefold() for role in list_roles(db)):
        raise HTTPException(status_code=409, detail="Роль с таким названием уже существует")
    key = "custom-" + secrets.token_hex(6)
    db.add(AppSetting(key=PREFIX + key, value=json.dumps(payload.model_dump(), ensure_ascii=False)))
    db.commit()
    return get_role(db, key)


@router.delete("/{key}")
def delete_role(key: str, db: Session = Depends(get_db)):
    if key in SYSTEM_ROLES:
        raise HTTPException(status_code=409, detail="Системные роли нельзя удалить")
    row = db.get(AppSetting, PREFIX + key)
    if not row:
        raise HTTPException(status_code=404, detail="Роль не найдена")
    if db.query(Employee).filter(Employee.role == key).count():
        raise HTTPException(status_code=409, detail="Сначала назначьте другую роль всем сотрудникам с этой ролью")
    db.delete(row)
    db.commit()
    return {"deleted": key}
