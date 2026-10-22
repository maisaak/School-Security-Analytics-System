import { useEffect, useRef } from "react";
import { api, LiveEvent } from "../api/client";

const EVENT_TYPES = [
  "violation.created",
  "violation.acknowledged",
  "violation.updated",
  "camera.offline",
  "camera.online",
  "camera.policy",
  "emergency",
  "visitor.created",
  "retention.cleanup",
];

interface Options {
  enabled?: boolean;
  onHello?: (recent: LiveEvent[]) => void;
}

/**
 * Подписка на серверную ленту событий (SSE).
 *
 * EventSource не умеет передавать Authorization, поэтому токен идёт в ?token=
 * (backend поддерживает этот транспорт для превью-прокси). При обрыве —
 * автоматический реконнект с паузой, без спама запросами.
 */
export function useEventStream(onEvent: (event: LiveEvent) => void, options: Options = {}): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const helloRef = useRef(options.onHello);
  helloRef.current = options.onHello;
  const enabled = options.enabled !== false;

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") return;
    let closed = false;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      try {
        source = new EventSource(api.eventsStreamUrl());
      } catch {
        retry = setTimeout(connect, 5000);
        return;
      }

      source.addEventListener("hello", (raw) => {
        try {
          const data = JSON.parse((raw as MessageEvent).data) as { recent?: LiveEvent[] };
          if (Array.isArray(data.recent)) helloRef.current?.(data.recent);
        } catch {
          // некорректный кадр игнорируем
        }
      });

      EVENT_TYPES.forEach((type) => {
        source?.addEventListener(type, (raw) => {
          try {
            const payload = JSON.parse((raw as MessageEvent).data) as Record<string, unknown>;
            handlerRef.current({
              id: Number((raw as MessageEvent).lastEventId || 0),
              type,
              ts: new Date().toISOString(),
              payload,
            });
          } catch {
            // ignore malformed
          }
        });
      });

      source.onerror = () => {
        source?.close();
        source = null;
        if (!closed) retry = setTimeout(connect, 4000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [enabled]);
}
