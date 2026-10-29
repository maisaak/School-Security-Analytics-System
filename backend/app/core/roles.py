import json

from app.db.models import AppSetting

PERMISSIONS = {"review_incidents": "Обработка инцидентов", "analyze_files": "Проверка фото и видео"}
SYSTEM_ROLES = {
    "admin": {"name": "Администратор", "description": "Полное управление системой", "permissions": list(PERMISSIONS)},
    "operator": {"name": "Охрана", "description": "Мониторинг, обработка инцидентов и проверка файлов", "permissions": list(PERMISSIONS)},
    "viewer": {"name": "Директор", "description": "Просмотр камер, архива и аналитики", "permissions": []},
}
PREFIX = "custom_role:"


def get_role(db, key):
    if key in SYSTEM_ROLES:
        return {"key": key, **SYSTEM_ROLES[key], "is_system": True}
    row = db.get(AppSetting, PREFIX + key)
    if not row:
        return None
    return {"key": key, **json.loads(row.value), "is_system": False}
