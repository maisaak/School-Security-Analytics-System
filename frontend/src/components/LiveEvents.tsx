import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, BellRing, CheckCircle2, Radio, Siren, WifiOff, X } from "lucide-react";
import { api, EmergencyState, LiveEvent } from "../api/client";
import { useEventStream } from "../hooks/useEventStream";

export interface LiveToast {
  id: number;
  kind: "weapon" | "suspicious_bag" | "dog" | "info" | "offline" | "ack";
  title: string;
  detail: string;
  at: string;
  violationId?: number;
}

interface LiveEventsValue {
  unacknowledged: number;
  connected: boolean;
  emergency: EmergencyState;
  toasts: LiveToast[];
  dismissToast: (id: number) => void;
  refreshEmergency: () => Promise<void>;
  setEmergency: (active: boolean, reason: string) => Promise<void>;
  acknowledge: (id: number) => Promise<void>;
  clearToasts: () => void;
}

const LiveEventsContext = createContext<LiveEventsValue | null>(null);

const TYPE_LABEL: Record<string, string> = {
  weapon: "Оружие",
  suspicious_bag: "Бесхозная сумка",
  dog: "Собака на территории",
};

function playAlert(kind: LiveToast["kind"]) {
  try {
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const beep = (frequency: number, start: number, duration: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(ctx.currentTime + start);
      oscillator.stop(ctx.currentTime + start + duration + 0.02);
    };
    if (kind === "weapon") {
      beep(920, 0, 0.16);
      beep(920, 0.24, 0.16);
      beep(1180, 0.48, 0.22);
    } else if (kind === "info" || kind === "ack") {
      beep(660, 0, 0.12);
    } else {
      beep(560, 0, 0.18);
      beep(760, 0.22, 0.18);
    }
    setTimeout(() => void ctx.close(), 1400);
  } catch {
    // автовоспроизведение может быть заблокировано до первого клика
  }
}

export const LiveEventsProvider: React.FC<{
  children: React.ReactNode;
  soundEnabled?: boolean;
  toastsEnabled?: boolean;
}> = ({ children, soundEnabled = true, toastsEnabled = true }) => {
  const [unacknowledged, setUnacknowledged] = useState(0);
  const [connected, setConnected] = useState(false);
  const [emergency, setEmergencyState] = useState<EmergencyState>({
    active: false,
    reason: "",
    started_at: null,
    started_by: null,
    cleared_at: null,
    cleared_by: null,
  });
  const [toasts, setToasts] = useState<LiveToast[]>([]);
  const baseTitle = useRef<string>(typeof document !== "undefined" ? document.title : "");
  const seen = useRef<Set<number>>(new Set());

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<LiveToast, "id" | "at">) => {
      if (!toastsEnabled) return;
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((current) => [{ ...toast, id, at: new Date().toISOString() }, ...current].slice(0, 4));
      setTimeout(() => dismissToast(id), toast.kind === "weapon" ? 15000 : 9000);
      if (soundEnabled) playAlert(toast.kind);
    },
    [dismissToast, soundEnabled, toastsEnabled]
  );

  const refreshEmergency = useCallback(async () => {
    try {
      const state = await api.getEmergency();
      setEmergencyState(state);
    } catch {
      // нет доступа или сеть недоступна — баннер просто не показываем
    }
  }, []);

  useEffect(() => {
    refreshEmergency();
    api
      .getStats()
      .then((stats) => setUnacknowledged(stats.unacknowledged_violations))
      .catch(() => {});
  }, [refreshEmergency]);

  const handleEvent = useCallback(
    (event: LiveEvent) => {
      const payload = event.payload as Record<string, unknown>;
      if (event.type === "violation.created") {
        const violationId = Number(payload.id || 0);
        if (violationId && seen.current.has(violationId)) return;
        if (violationId) seen.current.add(violationId);
        setUnacknowledged((count) => count + 1);
        const type = String(payload.violation_type || "weapon") as LiveToast["kind"];
        const camera = String(payload.camera_name || "Камера");
        const location = String(payload.camera_location || "");
        pushToast({
          kind: type,
          title: `Тревога: ${TYPE_LABEL[type] ?? type}`,
          detail: `${camera}${location ? ` · ${location}` : ""} · ${Math.round(Number(payload.confidence || 0) * 100)}%`,
          violationId,
        });
      } else if (event.type === "violation.acknowledged") {
        setUnacknowledged((count) => Math.max(0, count - 1));
        pushToast({
          kind: "ack",
          title: "Тревога отработана",
          detail: `${payload.acknowledged_by ?? "охрана"} · реакция ${Number(payload.latency_sec ?? 0).toFixed(0)} с`,
        });
      } else if (event.type === "violation.updated" && payload.is_acknowledged === false) {
        setUnacknowledged((count) => count + 1);
      } else if (event.type === "camera.offline") {
        pushToast({
          kind: "offline",
          title: "Камера недоступна",
          detail: `${payload.camera_name ?? "Камера"} · watchdog перезапускает поток`,
        });
      } else if (event.type === "camera.online") {
        pushToast({ kind: "info", title: "Камера снова онлайн", detail: String(payload.camera_name ?? "") });
      } else if (event.type === "emergency") {
        const active = Boolean(payload.active);
        setEmergencyState(payload as unknown as EmergencyState);
        pushToast({
          kind: "weapon",
          title: active ? "РЕЖИМ ЭВАКУАЦИИ" : "Тревога отменена",
          detail: String(payload.reason || (active ? "Все камеры на видеостене" : "Штатный режим")),
        });
      }
    },
    [pushToast]
  );

  useEventStream(handleEvent, {
    onHello: (recent) => {
      setConnected(true);
      // после переподключения восстанавливаем счётчик неподтверждённых
      api
        .getStats()
        .then((stats) => setUnacknowledged(stats.unacknowledged_violations))
        .catch(() => {});
      const emergencyEvent = recent.filter((item) => item.type === "emergency").pop();
      if (emergencyEvent) setEmergencyState(emergencyEvent.payload as unknown as EmergencyState);
    },
  });

  useEffect(() => {
    const base = baseTitle.current.replace(/^\(\d+\)\s*/, "");
    document.title = unacknowledged > 0 ? `(${unacknowledged}) ${base}` : base;
  }, [unacknowledged]);

  const setEmergency = useCallback(async (active: boolean, reason: string) => {
    const state = await api.setEmergency(active, reason);
    setEmergencyState(state);
  }, []);

  const acknowledge = useCallback(async (id: number) => {
    await api.acknowledgeViolation(id);
    setUnacknowledged((count) => Math.max(0, count - 1));
  }, []);

  const clearToasts = useCallback(() => setToasts([]), []);

  const value = useMemo<LiveEventsValue>(
    () => ({
      unacknowledged,
      connected,
      emergency,
      toasts,
      dismissToast,
      refreshEmergency,
      setEmergency,
      acknowledge,
      clearToasts,
    }),
    [unacknowledged, connected, emergency, toasts, dismissToast, refreshEmergency, setEmergency, acknowledge, clearToasts]
  );

  return <LiveEventsContext.Provider value={value}>{children}</LiveEventsContext.Provider>;
};

export function useLiveEvents(): LiveEventsValue {
  const ctx = useContext(LiveEventsContext);
  if (!ctx) throw new Error("useLiveEvents используется вне LiveEventsProvider");
  return ctx;
}

const TOAST_STYLE: Record<LiveToast["kind"], string> = {
  weapon: "tinted-red border-red-500/60 bg-red-950/90",
  suspicious_bag: "border-amber-500/50 bg-amber-950/90",
  dog: "border-orange-500/50 bg-orange-950/90",
  offline: "border-slate-600 bg-slate-900/95",
  info: "border-brand-500/50 bg-slate-900/95",
  ack: "border-emerald-500/50 bg-emerald-950/90",
};

export const EventToasts: React.FC = () => {
  const { toasts, dismissToast } = useLiveEvents();
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed z-[60] right-2 sm:right-4 top-[4.6rem] sm:top-20 w-[min(92vw,22rem)] space-y-2 pointer-events-none"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`fade-up pointer-events-auto rounded-2xl border shadow-2xl p-3 flex items-start gap-2.5 backdrop-blur ${TOAST_STYLE[toast.kind]}`}
        >
          <div className="mt-0.5 shrink-0">
            {toast.kind === "weapon" ? (
              <AlertTriangle className="w-4 h-4 text-red-300" />
            ) : toast.kind === "offline" ? (
              <WifiOff className="w-4 h-4 text-slate-300" />
            ) : toast.kind === "ack" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            ) : (
              <BellRing className="w-4 h-4 text-amber-300" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-ink leading-tight">{toast.title}</p>
            <p className="text-[10.5px] text-slate-300 mt-0.5 break-words">{toast.detail}</p>
          </div>
          <button
            onClick={() => dismissToast(toast.id)}
            className="p-1 rounded-lg text-slate-400 hover:text-ink hover:bg-white/10 transition"
            aria-label="Закрыть уведомление"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};

export const EmergencyBanner: React.FC<{ onOpenWall: () => void; canClear: boolean }> = ({
  onOpenWall,
  canClear,
}) => {
  const { emergency, setEmergency } = useLiveEvents();
  const [busy, setBusy] = useState(false);
  if (!emergency.active) return null;

  const clear = async () => {
    setBusy(true);
    try {
      await setEmergency(false, "Отбой тревоги");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sticky top-0 z-50 border-y border-red-500/70 bg-red-700 text-white shadow-lg">
      <div className="max-w-[1500px] mx-auto px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-white/15">
            <Siren className="w-5 h-5 animate-pulse" />
          </span>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-bold tracking-wide uppercase">Режим эвакуации</p>
            <p className="text-[10.5px] sm:text-[11px] text-red-100 truncate">
              {emergency.reason || "Тревога"} · {emergency.started_by ?? "система"}
              {emergency.started_at ? ` · ${new Date(emergency.started_at).toLocaleTimeString("ru-RU")}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenWall}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-red-700 text-[11px] font-semibold hover:bg-red-50 transition"
          >
            <Radio className="w-3.5 h-3.5" /> Все камеры
          </button>
          {canClear && (
            <button
              onClick={clear}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-950/40 border border-white/40 text-[11px] font-semibold hover:bg-red-900/50 transition disabled:opacity-60"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Отбой
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
