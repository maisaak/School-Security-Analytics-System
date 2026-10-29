from app.core.config import settings
from app.services import notifications


def test_notifications_are_disabled_without_configuration(monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "")
    monkeypatch.setattr(settings, "TELEGRAM_CHAT_ID", "")
    monkeypatch.setattr(settings, "NOTIFICATION_WEBHOOK_URL", "")
    called = []
    monkeypatch.setattr(notifications, "_safe_deliver", lambda *args: called.append(args))
    notifications.notify_incident("dog", "Entrance", 0.9)
    assert called == []


def test_notification_cooldown_deduplicates(monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setattr(settings, "TELEGRAM_CHAT_ID", "chat")
    monkeypatch.setattr(settings, "NOTIFICATION_COOLDOWN_SEC", 60)
    monkeypatch.setattr(notifications, "_last_sent", {})
    called = []
    monkeypatch.setattr(notifications, "_safe_deliver", lambda *args: called.append(args))
    class ImmediateThread:
        def __init__(self, target, args, daemon):
            self.target, self.args = target, args

        def start(self):
            self.target(*self.args)

    monkeypatch.setattr(notifications.threading, "Thread", ImmediateThread)
    notifications.notify_incident("dog", "Entrance", 0.9)
    notifications.notify_incident("dog", "Entrance", 0.9)
    notifications.notify_incident("weapon", "Entrance", 0.9)
    assert len(called) == 2
