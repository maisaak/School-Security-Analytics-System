import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  Hourglass,
  ScanEye,
  ShieldAlert,
  Timer,
  Video,
} from "lucide-react";
import { api, Camera, DashboardStats, Violation } from "../api/client";
import { VIOLATION_META } from "../components/ViolationsTable";
import { ErrorNotice, formatDateTime, Pill, SectionCard, Spinner } from "../components/ui";

export const AnalyticsPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangeHours, setRangeHours] = useState(24);

  const load = useCallback(async () => {
    try {
      const [st, viols, cams] = await Promise.all([
        api.getStats(),
        api.getViolations({ limit: 500 }),
        api.getCameras(),
      ]);
      setStats(st);
      setViolations(viols);
      setCameras(cams);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить аналитику");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 6000);
    return () => clearInterval(timer);
  }, [load]);

  const scoped = useMemo(() => {
    const cutoff = Date.now() - rangeHours * 3600 * 1000;
    return violations.filter((v) => new Date(v.detected_at).getTime() >= cutoff);
  }, [violations, rangeHours]);

  const byCamera = useMemo(() => {
    const map = new Map<number, { name: string; location: string; total: number; unack: number; weapon: number }>();
    cameras.forEach((c) => map.set(c.id, { name: c.name, location: c.location, total: 0, unack: 0, weapon: 0 }));
    scoped.forEach((v) => {
      const entry = map.get(v.camera_id);
      if (!entry) return;
      entry.total += 1;
      if (!v.is_acknowledged) entry.unack += 1;
      if (v.violation_type === "weapon") entry.weapon += 1;
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [scoped, cameras]);

  const byHour = useMemo(() => {
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const end = Date.now() - i * 3600 * 1000;
      const start = end - 3600 * 1000;
      return {
        label: new Date(end).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
        start,
        end,
        count: 0,
      };
    }).reverse();
    scoped.forEach((v) => {
      const ts = new Date(v.detected_at).getTime();
      const bucket = buckets.find((b) => ts >= b.start && ts < b.end);
      if (bucket) bucket.count += 1;
    });
    return buckets;
  }, [scoped]);

  const maxHour = Math.max(1, ...byHour.map((b) => b.count));

  const responseTime = useMemo(() => {
    const acked = scoped.filter((v) => v.is_acknowledged && v.acknowledged_at);
    if (acked.length === 0) return null;
    const deltas = acked.map(
      (v) => (new Date(v.acknowledged_at as string).getTime() - new Date(v.detected_at).getTime()) / 1000
    );
    return deltas.reduce((a, b) => a + b, 0) / deltas.length;
  }, [scoped]);

  const dwellList = scoped.filter((v) => v.dwell_seconds !== null && v.dwell_seconds !== undefined);
  const avgDwell = dwellList.length
    ? dwellList.reduce((sum, v) => sum + (v.dwell_seconds ?? 0), 0) / dwellList.length
    : 0;

  if (loading && !stats) return <Spinner label="Сбор аналитики…" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-sky-400" />
            Аналитика безопасности
          </h2>
          <p className="text-[11px] text-slate-400">
            Сводные показатели по инцидентам, камерам, трекингу и модели YOLOv8
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={rangeHours}
            onChange={(e) => setRangeHours(Number(e.target.value))}
            className="bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-sky-500"
          >
            <option value={1}>Последний час</option>
            <option value={8}>Последние 8 часов</option>
            <option value={24}>Последние 24 часа</option>
            <option value={24 * 30}>Последние 30 дней</option>
          </select>
          <Pill tone="slate">
            <Activity className="w-3 h-3" /> Записей в выборке: {scoped.length}
          </Pill>
        </div>
      </div>

      {error && <ErrorNotice message={error} onRetry={load} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {[
          {
            title: "Всего инцидентов",
            value: scoped.length,
            sub: `из ${stats?.total_violations ?? 0} в архиве`,
            icon: AlertTriangle,
            tone: "text-amber-400 bg-amber-500/10 border-amber-500/25",
          },
          {
            title: "Неподтверждённые",
            value: scoped.filter((v) => !v.is_acknowledged).length,
            sub: "требуют реакции охраны",
            icon: Clock,
            tone: "text-red-400 bg-red-500/10 border-red-500/25",
          },
          {
            title: "Среднее время реакции",
            value: responseTime === null ? "—" : `${responseTime.toFixed(0)} с`,
            sub: "от детекции до подтверждения",
            icon: Timer,
            tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
          },
          {
            title: "Средняя выдержка",
            value: `${avgDwell.toFixed(1)} с`,
            sub: `порог тревоги ${(stats?.tracking.dwell_threshold_sec ?? 6).toFixed(0)} с`,
            icon: Hourglass,
            tone: "text-sky-400 bg-sky-500/10 border-sky-500/25",
          },
        ].map(({ title, value, sub, icon: Icon, tone }) => (
          <div key={title} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-slate-400">{title}</p>
              <p className="text-2xl font-bold text-ink mt-1">{value}</p>
              <p className="text-[10px] text-slate-500 mt-1">{sub}</p>
            </div>
            <div className={`p-2.5 rounded-xl border shrink-0 ${tone}`}>
              <Icon className="w-4 h-4" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SectionCard
          title="Инциденты по часам"
          subtitle="Последние 12 часов"
          icon={Activity}
          className="lg:col-span-2"
        >
          <div className="flex items-end gap-1.5 h-40 pt-2">
            {byHour.map((bucket) => (
              <div key={`${bucket.label}-${bucket.start}`} className="flex-1 flex flex-col items-center gap-1.5">
                <span className="text-[9px] font-mono text-slate-400">{bucket.count || ""}</span>
                <div className="w-full bg-slate-950 rounded-md h-28 flex items-end p-0.5 border border-slate-800/70">
                  <div
                    className="w-full rounded-sm bg-gradient-to-t from-sky-600 to-sky-400 transition-all duration-500"
                    style={{
                      height: `${bucket.count === 0 ? 6 : Math.max(12, (bucket.count / maxHour) * 100)}%`,
                      opacity: bucket.count === 0 ? 0.22 : 1,
                    }}
                    title={`${bucket.label} — ${bucket.count}`}
                  />
                </div>
                <span className="text-[9px] text-slate-500 font-mono">{bucket.label}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Состояние модели" subtitle="Реестр версий и Validation Gate" icon={Cpu}>
          <dl className="space-y-2.5 text-[11px]">
            {[
              ["Активные веса", stats?.model.active_weights ?? "—", "font-mono text-slate-200"],
              [
                "Production-версия",
                stats?.model.production_version ?? "не зарегистрирована",
                "font-mono text-emerald-300",
              ],
              [
                "mAP@50",
                stats?.model.production_map50 !== null && stats?.model.production_map50 !== undefined
                  ? `${(stats.model.production_map50 * 100).toFixed(2)}%`
                  : "—",
                "font-mono text-emerald-300",
              ],
              [
                "Средний инференс",
                stats ? `${stats.model.avg_latency_ms.toFixed(1)} мс` : "—",
                "font-mono text-brand-300",
              ],
              ["Перезагрузка весов", stats ? formatDateTime(stats.model.reloaded_at) : "—", "text-slate-400"],
            ].map(([label, value, cls]) => (
              <div key={label} className="flex items-start justify-between gap-3 border-b border-slate-800/60 pb-2 last:border-0">
                <dt className="text-slate-500 shrink-0">{label}</dt>
                <dd className={`text-right ${cls}`}>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 text-[10px] text-slate-400 space-y-1">
            <p className="flex items-center gap-1.5">
              <ScanEye className="w-3 h-3 text-sky-400" />
              Трекер: ByteTrack-подобный IoU + прогноз центра
            </p>
            <p className="flex items-center gap-1.5">
              <Hourglass className="w-3 h-3 text-amber-400" />
              Выдержка бесхозного предмета: {(stats?.tracking.dwell_threshold_sec ?? 6).toFixed(0)} с
            </p>
            <p className="flex items-center gap-1.5">
              <ShieldAlert className="w-3 h-3 text-red-400" />
              Откат весов при падении mAP@50 ниже базового
            </p>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Нагрузка по камерам" subtitle="Инциденты за выбранный период" icon={Video}>
          <div className="space-y-2.5">
            {byCamera.map((cam) => {
              const max = Math.max(1, ...byCamera.map((c) => c.total));
              return (
                <div key={cam.name} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300 truncate">{cam.name}</span>
                    <span className="font-mono text-slate-400 shrink-0 ml-2">
                      {cam.total}
                      {cam.unack > 0 && <span className="text-amber-400"> · {cam.unack} новых</span>}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full ${cam.weapon > 0 ? "bg-red-500" : "bg-sky-500"} transition-all duration-500`}
                      style={{ width: `${(cam.total / max) * 100}%` }}
                    />
                  </div>
                  <p className="text-[9px] text-slate-600">{cam.location}</p>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          title="Последние инциденты"
          subtitle="Скачивание доступно директору и администратору"
          icon={AlertTriangle}
          actions={
            <Pill tone="slate">
              <CheckCircle2 className="w-3 h-3" />
              Отработано: {scoped.filter((v) => v.is_acknowledged).length}
            </Pill>
          }
        >
          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {scoped.slice(0, 30).map((v) => {
              const meta = VIOLATION_META[v.violation_type] ?? VIOLATION_META.suspicious_bag;
              return (
                <div
                  key={v.id}
                  className="flex items-center gap-2.5 rounded-lg border border-slate-800/80 bg-slate-950/60 px-2.5 py-2"
                >
                  <img
                    src={api.mediaUrl(v.image_path)}
                    alt={meta.title}
                    loading="lazy"
                    className="w-12 h-8 rounded object-cover border border-slate-800 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-slate-200 truncate">
                      {meta.title} · {v.camera_name}
                    </p>
                    <p className="text-[9px] text-slate-500 font-mono">{formatDateTime(v.detected_at)}</p>
                  </div>
                  <a
                    href={api.videoDownloadUrl(v)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition shrink-0"
                    title="Скачать видеофрагмент"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                </div>
              );
            })}
            {scoped.length === 0 && (
              <p className="py-8 text-center text-[11px] text-slate-500">За выбранный период инцидентов нет</p>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
};
