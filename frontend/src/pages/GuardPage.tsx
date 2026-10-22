import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  CheckCircle2,
  Clock,
  Expand,
  Hourglass,
  Maximize2,
  Minimize2,
  MonitorPlay,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  Siren,
  Timer,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { api, Camera, DashboardStats, SlaReport, Violation } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useLiveEvents } from "../components/LiveEvents";
import { CameraStream } from "../components/CameraStream";
import { VIOLATION_META } from "../components/ViolationsTable";
import { VideoModal } from "../components/VideoModal";
import { EmptyState, ErrorNotice, formatDateTime, Pill, SectionCard } from "../components/ui";

interface GuardPageProps {
  onGlobalStatsUpdate: (stats: DashboardStats) => void;
}

/**
 * Рабочее место охранника КПП: видеостена, лента тревог, подтверждение отработки
 * и быстрый просмотр фото/видео нарушений.
 */
export const GuardPage: React.FC<GuardPageProps> = ({ onGlobalStatsUpdate }) => {
  const { can } = useAuth();
  const { emergency, setEmergency } = useLiveEvents();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [alarms, setAlarms] = useState<Violation[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeVideo, setActiveVideo] = useState<Violation | null>(null);
  const [expandedCamera, setExpandedCamera] = useState<Camera | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [onlyUnack, setOnlyUnack] = useState(true);
  const knownIds = useRef<Set<number>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  // v3: видеостена на весь экран, автосмена камер и SLA смены
  const [wallOpen, setWallOpen] = useState(false);
  const [wallIndex, setWallIndex] = useState(0);
  const [rotateSec, setRotateSec] = useState(10);
  const [wallPaused, setWallPaused] = useState(false);
  const [sla, setSla] = useState<SlaReport | null>(null);
  const [sirenBusy, setSirenBusy] = useState(false);
  const wallRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const [cams, viols, st] = await Promise.all([
        api.getCameras(),
        api.getViolations({ limit: 200 }),
        api.getStats(),
      ]);
      setCameras(cams);
      setStats(st);
      onGlobalStatsUpdate(st);
      setAlarms(viols);
      setError(null);

      const incoming = viols.filter((v) => !knownIds.current.has(v.id));
      if (knownIds.current.size > 0 && incoming.length > 0) {
        setFreshIds(new Set(incoming.map((v) => v.id)));
        if (soundOn) playAlarmTone();
      }
      incoming.forEach((v) => knownIds.current.add(v.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить тревоги");
    }
  }, [onGlobalStatsUpdate, soundOn]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const fetchSla = () => api.getSla(1).then(setSla).catch(() => {});
    fetchSla();
    const timer = setInterval(fetchSla, 15000);
    return () => clearInterval(timer);
  }, []);

  // Тревога эвакуации автоматически разворачивает видеостену
  useEffect(() => {
    if (emergency.active) setWallOpen(true);
  }, [emergency.active]);

  useEffect(() => {
    if (!wallOpen || wallPaused || rotateSec <= 0 || cameras.length < 2) return;
    const timer = setInterval(() => {
      setWallIndex((index) => (index + 1) % cameras.length);
    }, rotateSec * 1000);
    return () => clearInterval(timer);
  }, [wallOpen, wallPaused, rotateSec, cameras.length]);

  // F11 / «w» — видеостена, Esc — выход. Браузерный F11 перехватываем,
  // чтобы стена открывалась внутри приложения, а не только полноэкранный режим.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "F11" || (event.key.toLowerCase() === "w" && event.altKey)) {
        event.preventDefault();
        setWallOpen(true);
      } else if (event.key === "Escape" && wallOpen) {
        setWallOpen(false);
      } else if (event.key === "ArrowRight" && wallOpen && cameras.length > 1) {
        setWallIndex((index) => (index + 1) % cameras.length);
      } else if (event.key === " " && wallOpen) {
        event.preventDefault();
        setWallPaused((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [wallOpen, cameras.length]);

  const toggleFullscreen = async () => {
    const node = wallRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await node.requestFullscreen();
      }
    } catch {
      // iOS Safari не даёт Fullscreen API для div — остаёмся в полноэкранном оверлее
    }
  };

  const triggerEmergency = async () => {
    if (sirenBusy) return;
    if (!window.confirm("Включить режим эвакуации? Все камеры будут развёрнуты на видеостене, директор и охрана получат уведомление.")) {
      return;
    }
    setSirenBusy(true);
    try {
      await setEmergency(true, "Тревога с поста охраны");
      setWallOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось включить режим эвакуации");
    } finally {
      setSirenBusy(false);
    }
  };

  const visibleAlarms = useMemo(
    () => (onlyUnack ? alarms.filter((a) => !a.is_acknowledged) : alarms),
    [alarms, onlyUnack]
  );

  const critical = alarms.filter((a) => !a.is_acknowledged && a.violation_type === "weapon");
  const pending = alarms.filter((a) => !a.is_acknowledged);

  const handleAck = async (id: number) => {
    const updated = await api.acknowledgeViolation(id);
    setAlarms((prev) => prev.map((a) => (a.id === id ? updated : a)));
    if (activeVideo?.id === id) setActiveVideo(updated);
    setFreshIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            Рабочее место охранника КПП
          </h2>
          <p className="text-[11px] text-slate-400">
            Видеостена, тревоги и подтверждение отработки · live-лента событий и SLA смены
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {critical.length > 0 && (
            <Pill tone="red" className="animate-pulse">
              <ShieldAlert className="w-3 h-3" />
              КРИТИЧЕСКИХ ТРЕВОГ: {critical.length}
            </Pill>
          )}
          <Pill tone={pending.length ? "amber" : "emerald"}>
            <AlarmClock className="w-3 h-3" />
            Неподтверждённых: {pending.length}
          </Pill>
          <button
            onClick={() => setSoundOn((v) => !v)}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 transition"
            title={soundOn ? "Отключить звук тревог" : "Включить звук тревог"}
          >
            {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button
            onClick={() => {
              setWallIndex(0);
              setWallOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-[11px] text-slate-200 transition"
            title="Видеостена на весь экран (F11), автосмена камер"
          >
            <MonitorPlay className="w-4 h-4" /> Видеостена
          </button>
          {can("emergency:trigger") && (
            <button
              onClick={triggerEmergency}
              disabled={sirenBusy || emergency.active}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold transition disabled:opacity-60"
              title="Режим эвакуации: все камеры на стену, сигнал директору"
            >
              <Siren className="w-4 h-4" /> {emergency.active ? "Тревога" : "Эвакуация"}
            </button>
          )}
        </div>
      </div>

      {error && <ErrorNotice message={error} onRetry={load} />}

      {sla && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[
            { label: "Средняя реакция", value: sla.avg_latency_sec, suffix: "с", tone: "text-brand-300" },
            { label: "Медиана", value: sla.median_latency_sec, suffix: "с", tone: "text-sky-300" },
            { label: "Просрочено SLA", value: sla.overdue_count, suffix: `из ${sla.measured}`, tone: sla.overdue_count ? "text-red-300" : "text-emerald-300" },
            { label: "Ожидают", value: sla.pending, suffix: "тревог", tone: sla.pending ? "text-amber-300" : "text-emerald-300" },
          ].map((card) => (
            <div key={card.label} className="rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1">
                <Timer className="w-3 h-3" /> {card.label}
              </p>
              <p className={`text-lg font-semibold ${card.tone}`}>
                {card.value === null || card.value === undefined ? "—" : card.value}
                <span className="text-[10px] font-normal text-slate-500 ml-1">{card.suffix}</span>
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {cameras.map((cam) => {
              const hasThreat = cam.active_threats.length > 0;
              return (
                <div
                  key={cam.id}
                  className={`relative rounded-2xl overflow-hidden border bg-slate-950 group ${
                    hasThreat ? "border-red-500/80 ring-2 ring-red-500/25" : "border-slate-800"
                  }`}
                >
                  <div className="aspect-video">
                    <CameraStream camera={cam} showSwitch={false} />
                  </div>

                  <div className="absolute top-2 left-2 flex flex-wrap gap-1.5 max-w-[85%]">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold backdrop-blur-md ${
                        !cam.is_active
                          ? "bg-slate-800/90 text-slate-300"
                          : hasThreat
                          ? "bg-red-600/95 text-white animate-pulse"
                          : "bg-slate-950/85 text-emerald-400 border border-emerald-500/30"
                      }`}
                    >
                      {cam.is_active ? (hasThreat ? "ТРЕВОГА" : "LIVE") : "ПАУЗА"}
                    </span>
                    {(cam.bag_tracking ?? [])
                      .filter((t) => t.state === "holding")
                      .slice(0, 1)
                      .map((t) => (
                        <span
                          key={t.track_id}
                          className="px-2 py-0.5 rounded text-[10px] font-semibold backdrop-blur-md bg-amber-500/90 text-slate-950 flex items-center gap-1"
                        >
                          <Hourglass className="w-3 h-3" />
                          {t.dwell_seconds.toFixed(1)} с
                        </span>
                      ))}
                  </div>

                  <button
                    onClick={() => setExpandedCamera(cam)}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-950/75 text-slate-200 opacity-0 group-hover:opacity-100 transition"
                    title="Развернуть"
                  >
                    <Expand className="w-3.5 h-3.5" />
                  </button>

                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950/95 to-transparent px-2.5 py-2">
                    <p className="text-[11px] font-semibold text-ink truncate">{cam.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {cam.location} · {cam.fps.toFixed(0)} FPS · {cam.person_count} чел.
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
            <Pill tone="slate">
              <MonitorPlay className="w-3 h-3" /> Камер: {cameras.length}
            </Pill>
            <Pill tone="slate">
              Онлайн: {cameras.filter((c) => c.online).length}
            </Pill>
            <Pill tone="slate">
              <Hourglass className="w-3 h-3" /> Выдержка: {(stats?.tracking.dwell_threshold_sec ?? 6).toFixed(0)} с
            </Pill>
          </div>
        </div>

        <SectionCard
          title="Лента тревог"
          subtitle="Подтвердите отработку после проверки"
          icon={AlarmClock}
          actions={
            <label className="inline-flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyUnack}
                onChange={(e) => setOnlyUnack(e.target.checked)}
                className="rounded accent-amber-500"
              />
              только новые
            </label>
          }
          className="xl:sticky xl:top-20 xl:max-h-[calc(100vh-7rem)] flex flex-col"
        >
          <div className="overflow-y-auto pr-1 -mr-1 space-y-2 flex-1">
            {visibleAlarms.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Активных тревог нет"
                description="Все инциденты отработаны. Новые срабатывания появятся здесь автоматически."
              />
            ) : (
              visibleAlarms.map((alarm) => {
                const meta = VIOLATION_META[alarm.violation_type] ?? VIOLATION_META.suspicious_bag;
                const isFresh = freshIds.has(alarm.id);
                return (
                  <div
                    key={alarm.id}
                    className={`rounded-xl border p-2.5 transition ${
                      alarm.is_acknowledged
                        ? "border-slate-800 bg-slate-950/60 opacity-70"
                        : isFresh
                        ? "border-red-500/70 bg-red-500/10 animate-pulse"
                        : "border-slate-800 bg-slate-950/80"
                    }`}
                  >
                    <div className="flex gap-2.5">
                      <button
                        onClick={() => setActiveVideo(alarm)}
                        className="relative w-20 h-14 rounded-lg overflow-hidden border border-slate-700 shrink-0 bg-black group"
                      >
                        <img
                          src={api.mediaUrl(alarm.image_path)}
                          alt={meta.title}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition"
                        />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 group-hover:opacity-100 transition">
                          <Play className="w-4 h-4 text-ink fill-white" />
                        </span>
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${meta.badgeClass}`}
                          >
                            {meta.title}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">
                            # {alarm.id}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-200 font-medium truncate mt-1">
                          {alarm.camera_name}
                        </p>
                        <p className="text-[10px] text-slate-500 font-mono">
                          {formatDateTime(alarm.detected_at)}
                        </p>
                        {alarm.track_id && (
                          <p className="text-[10px] text-sky-400 font-mono">
                            {alarm.track_id}
                            {alarm.dwell_seconds !== null
                              ? ` · ${alarm.dwell_seconds.toFixed(1)} с выдержки`
                              : ""}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        onClick={() => setActiveVideo(alarm)}
                        className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-medium text-slate-200 flex items-center justify-center gap-1 transition"
                      >
                        <Play className="w-3 h-3" /> Фото/видео
                      </button>
                      <button
                        onClick={() => handleAck(alarm.id)}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium flex items-center justify-center gap-1 transition ${
                          alarm.is_acknowledged
                            ? "bg-slate-800 text-slate-400 hover:bg-slate-700"
                            : "bg-emerald-600 hover:bg-emerald-500 text-white"
                        }`}
                      >
                        {alarm.is_acknowledged ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" /> Отработано
                          </>
                        ) : (
                          <>
                            <Clock className="w-3 h-3" /> Подтвердить
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SectionCard>
      </div>

      {wallOpen && (
        <div ref={wallRef} className="fixed inset-0 z-[70] bg-black flex flex-col">
          {(() => {
            const cam = cameras[wallIndex % Math.max(1, cameras.length)];
            if (!cam) {
              return (
                <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                  Камеры недоступны
                  <button onClick={() => setWallOpen(false)} className="ml-3 px-3 py-1.5 rounded-lg bg-slate-800 text-white">
                    Закрыть
                  </button>
                </div>
              );
            }
            return (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-black/80 border-b border-slate-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${cam.active_threats.length ? "bg-red-600 text-white animate-pulse" : "bg-emerald-600/90 text-white"}`}>
                      {cam.active_threats.length ? "ТРЕВОГА" : "LIVE"}
                    </span>
                    <p className="text-sm font-semibold text-white truncate">{cam.name}</p>
                    <span className="text-[11px] text-slate-400 truncate hidden sm:inline">{cam.location}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={rotateSec}
                      onChange={(e) => setRotateSec(Number(e.target.value))}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-slate-200"
                      title="Интервал автосмены камер"
                    >
                      <option value={0}>Без смены</option>
                      <option value={5}>5 с</option>
                      <option value={10}>10 с</option>
                      <option value={20}>20 с</option>
                      <option value={30}>30 с</option>
                    </select>
                    <button
                      onClick={() => setWallPaused((v) => !v)}
                      className="p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800"
                      title={wallPaused ? "Продолжить автосмену" : "Пауза автосмены"}
                    >
                      {wallPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => setWallIndex((i) => (i + 1) % Math.max(1, cameras.length))}
                      className="p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800"
                      title="Следующая камера"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={toggleFullscreen}
                      className="p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800"
                      title="Полный экран (F11)"
                    >
                      {typeof document !== "undefined" && document.fullscreenElement ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => setWallOpen(false)}
                      className="p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800"
                      title="Закрыть видеостену"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 bg-black">
                  <CameraStream camera={cam} showSwitch={false} className="w-full h-full object-contain" />
                </div>

                <div className="flex gap-2 p-2 bg-black/80 border-t border-slate-800 overflow-x-auto">
                  {cameras.map((item, index) => (
                    <button
                      key={item.id}
                      onClick={() => setWallIndex(index)}
                      className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[10px] transition ${
                        index === wallIndex % cameras.length
                          ? "border-brand-500 bg-brand-500/15 text-brand-200"
                          : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      <VideoModal
        violation={activeVideo}
        canAck
        onClose={() => setActiveVideo(null)}
        onAcknowledge={handleAck}
      />

      {expandedCamera && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-3">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-6xl w-full p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ink">{expandedCamera.name}</h3>
                <p className="text-[11px] text-slate-400">{expandedCamera.location}</p>
              </div>
              <button
                onClick={() => setExpandedCamera(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="w-full rounded-xl bg-black aspect-video overflow-hidden">
              <CameraStream
                camera={expandedCamera}
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Короткий двухтональный сигнал тревоги через Web Audio API (без внешних файлов). */
function playAlarmTone() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    // браузер может блокировать автозвук без пользовательского жеста — не критично
  }
}
