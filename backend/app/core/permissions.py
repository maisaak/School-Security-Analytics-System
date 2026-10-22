from __future__ import annotations

from enum import Enum


class Role(str, Enum):
    ADMIN = "admin"
    DIRECTOR = "director"
    GUARD = "guard"


ROLE_LABELS: dict[str, str] = {
    Role.ADMIN.value: "Администратор",
    Role.DIRECTOR.value: "Директор школы",
    Role.GUARD.value: "Охранник КПП",
}

ROLE_DESCRIPTIONS: dict[str, str] = {
    Role.ADMIN.value: "Полный доступ: камеры, удаление улик, дообучение YOLOv8, пользователи, аудит",
    Role.DIRECTOR.value: "Живой просмотр, аналитика, медиа инцидентов, подтверждение тревог, аудит",
    Role.GUARD.value: "Видеостена КПП, тревоги, подтверждение отработки, проверка медиафайлов",
}


class Permission(str, Enum):
    CAMERAS_VIEW = "cameras:view"
    CAMERAS_MANAGE = "cameras:manage"
    CAMERAS_SIMULATE = "cameras:simulate"
    VIOLATIONS_VIEW = "violations:view"
    VIOLATIONS_ACK = "violations:ack"
    VIOLATIONS_DELETE = "violations:delete"
    ANALYTICS_VIEW = "analytics:view"
    AUDIT_VIEW = "audit:view"
    MEDIA_CHECK = "media:check"
    MODELS_VIEW = "models:view"
    MODELS_TRAIN = "models:train"
    MODELS_ROLLBACK = "models:rollback"
    USERS_MANAGE = "users:manage"
    GUARD_CONSOLE = "guard:console"


ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.ADMIN: frozenset(Permission),
    Role.DIRECTOR: frozenset(
        {
            Permission.CAMERAS_VIEW,
            Permission.VIOLATIONS_VIEW,
            Permission.VIOLATIONS_ACK,
            Permission.ANALYTICS_VIEW,
            Permission.AUDIT_VIEW,
            Permission.MEDIA_CHECK,
            Permission.MODELS_VIEW,
        }
    ),
    Role.GUARD: frozenset(
        {
            Permission.CAMERAS_VIEW,
            Permission.VIOLATIONS_VIEW,
            Permission.VIOLATIONS_ACK,
            Permission.MEDIA_CHECK,
            Permission.GUARD_CONSOLE,
        }
    ),
}


def normalize_role(role: str | Role | None) -> Role:
    if isinstance(role, Role):
        return role
    try:
        return Role(str(role or "").strip().lower())
    except ValueError:
        return Role.GUARD


def role_permissions(role: str | Role | None) -> list[str]:
    return sorted(p.value for p in ROLE_PERMISSIONS[normalize_role(role)])


def has_permission(role: str | Role | None, permission: Permission | str) -> bool:
    perm = permission if isinstance(permission, Permission) else Permission(str(permission))
    return perm in ROLE_PERMISSIONS[normalize_role(role)]
