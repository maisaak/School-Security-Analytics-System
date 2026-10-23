from __future__ import annotations

import time

from fastapi import Request, Response

try:  # prometheus_client ставится из requirements; без него метрики просто не отдаются
    from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Gauge, Histogram, generate_latest
except Exception:  # pragma: no cover
    CollectorRegistry = None  # type: ignore[assignment]

REGISTRY = CollectorRegistry(auto_describe=True) if CollectorRegistry else None

if REGISTRY is not None:
    HTTP_REQUESTS = Counter(
        "school_http_requests_total",
        "HTTP-запросы к API",
        ["method", "path", "status"],
        registry=REGISTRY,
    )
    HTTP_LATENCY = Histogram(
        "school_http_request_duration_seconds",
        "Длительность HTTP-запросов",
        ["method", "path"],
        buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
        registry=REGISTRY,
    )
    VIOLATIONS = Counter(
        "school_violations_total",
        "Зафиксированные нарушения по типу и камере",
        ["violation_type", "camera"],
        registry=REGISTRY,
    )
    ACK_LATENCY = Histogram(
        "school_ack_latency_seconds",
        "Время реакции охраны: детекция → подтверждение",
        buckets=(5, 15, 30, 60, 120, 300, 600, 1800),
        registry=REGISTRY,
    )
    CAMERAS_ONLINE = Gauge(
        "school_cameras_online",
        "Камеры онлайн / всего",
        ["state"],
        registry=REGISTRY,
    )
    SSE_CLIENTS = Gauge(
        "school_sse_clients",
        "Активные SSE-подписчики",
        registry=REGISTRY,
    )
    EVENTS_SENT = Counter(
        "school_events_total",
        "События шины по типам",
        ["event_type"],
        registry=REGISTRY,
    )
    # Gauge с метками: выставляем total/online отдельными вызовами
    CAMERAS_ONLINE.labels(state="total").set(0)
    CAMERAS_ONLINE.labels(state="online").set(0)
else:  # pragma: no cover
    HTTP_REQUESTS = HTTP_LATENCY = VIOLATIONS = ACK_LATENCY = CAMERAS_ONLINE = SSE_CLIENTS = EVENTS_SENT = None


def metrics_available() -> bool:
    return REGISTRY is not None


def record_http(method: str, path: str, status_code: int, duration: float) -> None:
    if HTTP_REQUESTS is None:
        return
    # Кардинальность: ID в пути заменяем плейсхолдером
    normalized = path
    parts = [part for part in path.split("/") if part]
    parts = ["{id}" if part.isdigit() else part for part in parts]
    normalized = "/" + "/".join(parts)
    HTTP_REQUESTS.labels(method=method, path=normalized, status=str(status_code)).inc()
    HTTP_LATENCY.labels(method=method, path=normalized).observe(duration)


def record_violation(violation_type: str, camera: str) -> None:
    if VIOLATIONS is not None:
        VIOLATIONS.labels(violation_type=violation_type, camera=camera).inc()


def record_ack_latency(seconds: float) -> None:
    if ACK_LATENCY is not None:
        ACK_LATENCY.observe(max(0.0, seconds))


def set_cameras(total: int, online: int) -> None:
    if CAMERAS_ONLINE is not None:
        CAMERAS_ONLINE.labels(state="total").set(total)
        CAMERAS_ONLINE.labels(state="online").set(online)


def set_sse_clients(count: int) -> None:
    if SSE_CLIENTS is not None:
        SSE_CLIENTS.set(count)


def record_event(event_type: str) -> None:
    if EVENTS_SENT is not None:
        EVENTS_SENT.labels(event_type=event_type).inc()


def metrics_response() -> Response:
    if REGISTRY is None:
        return Response("# prometheus_client не установлен\n", media_type="text/plain")
    return Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)


async def metrics_middleware(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    if request.url.path.startswith("/api") or request.url.path.startswith("/media"):
        record_http(request.method, request.url.path, response.status_code, time.perf_counter() - started)
    return response
