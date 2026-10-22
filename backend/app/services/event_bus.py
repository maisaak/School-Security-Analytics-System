from __future__ import annotations

import asyncio
import itertools
import json
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class EventBus:
    """
    Внутрипроцессная шина событий для SSE-ленты «в реальном времени».

    Публикация может идти из потоков обработки видео (CameraWorker), поэтому
    подписчики хранят свой asyncio-цикл и очередь: из чужого потока кладём
    событие через call_soon_threadsafe. История (ring buffer) позволяет новому
    клиенту сразу получить последние инциденты, а не ждать следующего.
    """

    def __init__(self, history_size: int = 80) -> None:
        self._subscribers: dict[int, tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = {}
        self._lock = threading.Lock()
        self._ids = itertools.count(1)
        self._history: deque[dict[str, Any]] = deque(maxlen=history_size)
        self._total = 0

    def subscribe(self) -> tuple[int, asyncio.Queue]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        with self._lock:
            sub_id = next(self._ids)
            self._subscribers[sub_id] = (loop, queue)
        return sub_id, queue

    def unsubscribe(self, sub_id: int) -> None:
        with self._lock:
            self._subscribers.pop(sub_id, None)

    @staticmethod
    def _safe_put(queue: asyncio.Queue, event: dict[str, Any]) -> None:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            # Медленный клиент: пропускаем событие, чтобы не блокировать видеоконвейер
            pass

    def publish(self, event_type: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        event = {
            "id": self._total + 1,
            "type": event_type,
            "ts": _now_iso(),
            "payload": payload or {},
        }
        with self._lock:
            self._total += 1
            self._history.append(event)
            targets = list(self._subscribers.values())
        for loop, queue in targets:
            try:
                loop.call_soon_threadsafe(self._safe_put, queue, event)
            except RuntimeError:
                # цикл уже закрыт — подписчик отвалится сам
                continue
        return event

    def history(self, limit: int = 30) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._history)[-max(1, min(limit, 80)):]

    @property
    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._subscribers)

    @property
    def total_published(self) -> int:
        return self._total


event_bus = EventBus()


def sse_format(event: dict[str, Any]) -> str:
    """Формат Server-Sent Events: event + data + id."""
    return (
        f"id: {event['id']}\n"
        f"event: {event['type']}\n"
        f"data: {json.dumps(event['payload'], ensure_ascii=False, default=str)}\n\n"
    )


async def event_stream(sub_id: int, queue: asyncio.Queue, heartbeat_sec: float = 15.0):
    """
    Асинхронный генератор SSE.

    Первым сообщением отдаём накопленную историю (последние тревоги и статусы),
    затем — живые события. Каждые heartbeat_sec отправляем комментарий-пинг,
    чтобы прокси превью не закрывал «тихое» соединение.
    """
    yield "retry: 3000\n\n"
    yield sse_format(
        {
            "id": 0,
            "type": "hello",
            "payload": {
                "version": settings.APP_VERSION,
                "recent": event_bus.history(25),
            },
        }
    )
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=heartbeat_sec)
                yield sse_format(event)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
    except asyncio.CancelledError:  # клиент закрыл вкладку
        raise
    finally:
        event_bus.unsubscribe(sub_id)
