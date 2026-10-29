import json

from app.db.models import AppSetting

PERMISSIONS = {
    "view_monitoring": "Просмотр камер и мониторинга",
    "review_incidents": "Обработка инцидентов",
    "analyze_files": "Проверка фото и видео",
    "manage_cameras": "Добавление и настройка камер",
    "manage_employees": "Сотрудники и доступ",
    "manage_models": "Выбор моделей YOLO",
    "train_model": "Дообучение модели",
    "export_archive": "Экспорт архива и отчётов",
}
SYSTEM_ROLES = {
    "admin": {"name": "Администратор", "description": "Полное управление системой", "permissions": list(PERMISSIONS)},
    "operator": {"name": "Охрана", "description": "Мониторинг, обработка инцидентов и проверка файлов", "permissions": ["view_monitoring", "review_incidents", "analyze_files", "export_archive"]},
    "viewer": {"name": "Директор", "description": "Просмотр камер, архива и аналитики", "permissions": ["view_monitoring", "export_archive"]},
}
PREFIX = "custom_role:"


def get_role(db, key):
    if key in SYSTEM_ROLES:
        return {"key": key, **SYSTEM_ROLES[key], "is_system": True}
    row = db.get(AppSetting, PREFIX + key)
    if not row:
        return None
    return {"key": key, **json.loads(row.value), "is_system": False}
