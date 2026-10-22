import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  CheckCircle2,
  Clock,
  Expand,
  Hourglass,
  MonitorPlay,
  Play,
  ShieldAlert,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { api, Camera, DashboardStats, Violation } from "../api/client";
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
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

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
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            Рабочее место охранника КПП
          </h2>
          <p className="text-[11px] text-slate-400">
            Видеостена, тревоги и подтверждение отработки · обновление каждые 3 с
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
        </div>
      </div>

      {error && <ErrorNotice message={error} onRetry={load} />}

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
                    <p className="text-[11px] font-semibold text-white truncate">{cam.name}</p>
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
                          <Play className="w-4 h-4 text-white fill-white" />
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
                <h3 className="text-sm font-semibold text-white">{expandedCamera.name}</h3>
                <p className="text-[11px] text-slate-400">{expandedCamera.location}</p>
              </div>
              <button
                onClick={() => setExpandedCamera(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
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
