import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Flame,
  Gauge,
  Hourglass,
  ScanEye,
  ShieldAlert,
  Timer,
  Video,
} from "lucide-react";
import {
  AbReport,
  api,
  Camera,
  DashboardStats,
  HeatmapReport,
  QualityReport,
  ReportPreview,
  SlaReport,
  Violation,
} from "../api/client";
import { VIOLATION_META } from "../components/ViolationsTable";
import {
  ErrorNotice,
  formatDateTime,
  KpiCard,
  PageHeader,
  Pill,
  SectionCard,
  Segmented,
  SkeletonCards,
  SkeletonPanel,
} from "../components/ui";

export const AnalyticsPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangeHours, setRangeHours] = useState(24);
  const [sla, setSla] = useState<SlaReport | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapReport | null>(null);
  const [ab, setAb] = useState<AbReport | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [reportFrom, setReportFrom] = useState(() => {
    const date = new Date(Date.now() - 30 * 86400 * 1000);
    return date.toISOString().slice(0, 10);
  });
  const [reportTo, setReportTo] = useState(() => new Date().toISOString().slice(0, 10));

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

  const loadAdvanced = useCallback(async () => {
    const days = rangeHours <= 24 ? 1 : 30;
    const results = await Promise.allSettled([
      api.getSla(days),
      api.getHeatmap(days),
      api.getAbStats(days),
      api.getQuality(days),
      api.reportPreview({ date_from: reportFrom, date_to: reportTo }),
    ]);
    if (results[0].status === "fulfilled") setSla(results[0].value);
    if (results[1].status === "fulfilled") setHeatmap(results[1].value);
    if (results[2].status === "fulfilled") setAb(results[2].value);
    if (results[3].status === "fulfilled") setQuality(results[3].value);
    if (results[4].status === "fulfilled") setPreview(results[4].value);
  }, [rangeHours, reportFrom, reportTo]);

  useEffect(() => {
    loadAdvanced();
  }, [loadAdvanced]);

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

  if (loading && !stats)
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Отчётность"
          title="Аналитика безопасности"
          description="Сводные показатели по инцидентам, камерам, трекингу и модели YOLOv8."
          icon={BarChart3}
          tone="sky"
        />
        <SkeletonCards />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SkeletonPanel rows={6} className="lg:col-span-2" />
          <SkeletonPanel rows={6} />
        </div>
      </div>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Отчётность"
        title="Аналитика безопасности"
        description="Сводные показатели по инцидентам, камерам, трекингу и модели YOLOv8 · SLA реакции охраны, теплокарта и отчёты за произвольный период."
        icon={BarChart3}
        tone="sky"
        meta={
          <>
            <Pill tone="slate">
              <Activity className="w-3 h-3" /> Записей в выборке: {scoped.length}
            </Pill>
            <Pill tone="emerald">Обновление каждые 6 секунд</Pill>
          </>
        }
        actions={
          <Segmented
            ariaLabel="Период аналитики"
            value={rangeHours}
            onChange={(value) => setRangeHours(Number(value))}
            options={[
              { value: 1, label: "1 ч" },
              { value: 8, label: "8 ч" },
              { value: 24, label: "24 ч" },
              { value: 720, label: "30 дн" },
            ]}
          />
        }
      />

      {error && <ErrorNotice message={error} onRetry={load} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        {[
          {
            title: "Всего инцидентов",
            value: scoped.length,
            sub: `из ${stats?.total_violations ?? 0} в архиве`,
            icon: AlertTriangle,
            tone: "amber" as const,
          },
          {
            title: "Неподтверждённые",
            value: scoped.filter((v) => !v.is_acknowledged).length,
            sub: "требуют реакции охраны",
            icon: Clock,
            tone: "red" as const,
          },
          {
            title: "Среднее время реакции",
            value: responseTime === null ? "—" : `${responseTime.toFixed(0)} с`,
            sub: "от детекции до подтверждения",
            icon: Timer,
            tone: "emerald" as const,
          },
          {
            title: "Средняя выдержка",
            value: `${avgDwell.toFixed(1)} с`,
            sub: `порог тревоги ${(stats?.tracking.dwell_threshold_sec ?? 6).toFixed(0)} с`,
            icon: Hourglass,
            tone: "sky" as const,
          },
        ].map(({ title, value, sub, icon, tone }) => (
          <KpiCard key={title} label={title} value={value} hint={sub} icon={icon} tone={tone} />
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SectionCard
          title="SLA реакции охраны"
          subtitle={`Цель — подтвердить тревогу за ${sla?.target_sec ?? 60} с`}
          icon={Timer}
        >
          {sla ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { label: "Средняя реакция", value: sla.avg_latency_sec, suffix: "с" },
                  { label: "Медиана", value: sla.median_latency_sec, suffix: "с" },
                  { label: "95-й перцентиль", value: sla.p95_latency_sec, suffix: "с" },
                  { label: "Просрочено", value: sla.overdue_count, suffix: `из ${sla.measured}` },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <p className="text-[10px] text-slate-500">{item.label}</p>
                    <p className="text-lg font-semibold text-ink">
                      {item.value ?? "—"}
                      <span className="text-[10px] font-normal text-slate-500 ml-1">{item.suffix}</span>
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {(["day", "night"] as const).map((shift) => {
                  const data = sla.by_shift?.[shift];
                  if (!data) return null;
                  return (
                    <div key={shift} className="rounded-xl border border-slate-800/80 px-3 py-2">
                      <p className="text-[10px] text-slate-500">{data.label}</p>
                      <p className="text-[11px] text-slate-200">
                        {data.count} тревог · средняя {data.avg ?? "—"} с · просрочено {data.overdue}
                      </p>
                    </div>
                  );
                })}
              </div>

              {sla.overdue.length > 0 && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-red-300 mb-1.5">Просроченные подтверждения</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {sla.overdue.slice(0, 6).map((item) => (
                      <p key={item.id} className="text-[10.5px] text-slate-300 flex justify-between gap-2">
                        <span className="truncate">
                          #{item.id} · {item.camera_name} · {VIOLATION_META[item.violation_type as Violation["violation_type"]]?.title ?? item.violation_type}
                        </span>
                        <span className="font-mono text-red-300">{item.latency_sec} с</span>
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 text-[10.5px] text-slate-500">
                <span>Ожидают подтверждения: {sla.pending}</span>
                <a
                  href={api.slaReportUrl(rangeHours <= 24 ? 1 : 30)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                >
                  <FileText className="w-3 h-3" /> SLA-отчёт PDF
                </a>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 py-6 text-center">SLA ещё не рассчитан</p>
          )}
        </SectionCard>

        <SectionCard
          title="Отчёты за произвольный период"
          subtitle="PDF и Excel с водяным знаком: кто, когда и за какой период выгрузил"
          icon={FileText}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1">
                <span className="block text-[10px] uppercase text-slate-500">С даты</span>
                <input
                  type="date"
                  value={reportFrom}
                  onChange={(e) => setReportFrom(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5 text-[11px] text-slate-200"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] uppercase text-slate-500">По дату</span>
                <input
                  type="date"
                  value={reportTo}
                  onChange={(e) => setReportTo(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5 text-[11px] text-slate-200"
                />
              </label>
              <a
                href={api.reportUrl("pdf", { date_from: reportFrom, date_to: reportTo })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-[11px] text-white"
              >
                <FileText className="w-3.5 h-3.5" /> PDF
              </a>
              <a
                href={api.reportUrl("xlsx", { date_from: reportFrom, date_to: reportTo })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
              </a>
            </div>

            {preview ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                <p className="text-[10.5px] text-slate-500">Период: {preview.period}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  {[
                    { label: "Инцидентов", value: preview.summary.total },
                    { label: "Подтверждено", value: preview.summary.acknowledged },
                    { label: "Ложных", value: preview.summary.false_alarms },
                    { label: "Просрочено SLA", value: preview.summary.sla_overdue },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg bg-slate-900 px-2 py-1.5">
                      <p className="text-sm font-semibold text-ink">{item.value}</p>
                      <p className="text-[9px] text-slate-500">{item.label}</p>
                    </div>
                  ))}
                </div>
                {preview.summary.top_cameras.length > 0 && (
                  <p className="text-[10px] text-slate-400">
                    Топ камер: {preview.summary.top_cameras.map(([name, count]) => `${name} (${count})`).join(", ")}
                  </p>
                )}
                <p className="text-[9.5px] text-amber-300/80">Водяной знак: {preview.watermark}</p>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">Предпросмотр отчёта недоступен</p>
            )}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Теплокарта инцидентов"
        subtitle={`Дни недели × часы за ${heatmap?.period_days ?? 30} дн. · тёмный цвет — больше тревог`}
        icon={Flame}
        actions={
          quality ? (
            <div className="flex items-center gap-2">
              <Pill tone={quality.false_alarm_rate > 15 ? "amber" : "emerald"}>
                Ложных: {quality.false_alarm_rate}%
              </Pill>
              <Pill tone="slate">Подтверждено: {quality.ack_rate}%</Pill>
            </div>
          ) : undefined
        }
      >
        {heatmap ? (
          <div className="overflow-x-auto">
            <div className="min-w-[620px]">
              <div className="grid" style={{ gridTemplateColumns: `2.2rem repeat(24, minmax(0, 1fr))` }}>
                <div />
                {heatmap.hours.map((hour) => (
                  <div key={hour} className="text-center text-[8.5px] text-slate-500 pb-1">
                    {hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}
                  </div>
                ))}
                {heatmap.matrix.map((row, dayIndex) => (
                  <React.Fragment key={dayIndex}>
                    <div className="text-[10px] text-slate-400 pr-1 flex items-center justify-end">
                      {heatmap.weekday_labels[dayIndex]}
                    </div>
                    {row.map((value, hourIndex) => {
                      const intensity = heatmap.max_value ? value / heatmap.max_value : 0;
                      return (
                        <div
                          key={hourIndex}
                          title={`${heatmap.weekday_labels[dayIndex]}, ${String(hourIndex).padStart(2, "0")}:00 — ${value} инцидентов`}
                          className="m-[1px] h-5 rounded-[3px] border border-slate-900"
                          style={{
                            backgroundColor:
                              value === 0
                                ? "rgba(30,41,59,0.55)"
                                : `rgba(239, 68, 68, ${0.18 + intensity * 0.82})`,
                          }}
                        />
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Топ камер по ложным срабатываниям</p>
                {heatmap.top_false_alarm_cameras.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Ложных срабатываний не отмечено</p>
                ) : (
                  <div className="space-y-1">
                    {heatmap.top_false_alarm_cameras.map((item) => (
                      <div key={item.camera} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-300 truncate">{item.camera}</span>
                        <span className="font-mono text-amber-300 shrink-0">
                          {item.false_alarms} / {item.total} · {item.rate}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Топ камер по числу инцидентов</p>
                <div className="space-y-1">
                  {heatmap.top_cameras.map((item) => (
                    <div key={item.camera} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-slate-300 truncate">{item.camera}</span>
                      <span className="font-mono text-sky-300">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500 py-6 text-center">Теплокарта загружается…</p>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SectionCard
          title="Качество детекции"
          subtitle="Ложные срабатывания — основа активного обучения"
          icon={Gauge}
        >
          {quality ? (
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { label: "Всего инцидентов", value: quality.total, suffix: "" },
                { label: "Ложных срабатываний", value: quality.false_alarms, suffix: "" },
                { label: "Доля ложных", value: quality.false_alarm_rate, suffix: "%" },
                { label: "Средняя уверенность", value: quality.avg_confidence !== null ? Math.round(quality.avg_confidence * 100) : null, suffix: "%" },
                { label: "Медианная уверенность", value: quality.median_confidence !== null ? Math.round(quality.median_confidence * 100) : null, suffix: "%" },
                { label: "Подтверждено охраной", value: quality.ack_rate, suffix: "%" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-slate-800/70 bg-slate-950/40 px-3 py-2.5">
                  <p className="text-[10px] text-slate-500">{item.label}</p>
                  <p className="text-lg font-semibold text-ink">
                    {item.value ?? "—"}
                    <span className="text-[10px] font-normal text-slate-500 ml-1">{item.suffix}</span>
                  </p>
                </div>
              ))}
              <p className="col-span-2 text-[10.5px] text-slate-500">
                Отмечайте ложные срабатывания в журнале — они исключаются из датасета активного обучения и
                попадают в отчёт по качеству модели.
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 py-6 text-center">Метрики качества недоступны</p>
          )}
        </SectionCard>

        <SectionCard
          title="A/B-тест моделей"
          subtitle="Сравнение профилей детекции на реальных кадрах"
          icon={FlaskConical}
        >
          {ab && ab.variants.length > 0 ? (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="text-[9.5px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
                    <tr>
                      <th className="py-1.5 pr-2">Вариант</th>
                      <th className="py-1.5 pr-2">Срабатываний</th>
                      <th className="py-1.5 pr-2">Уверенность</th>
                      <th className="py-1.5 pr-2">Ложных</th>
                      <th className="py-1.5 pr-2">Реакция</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {ab.variants.map((variant) => (
                      <tr key={variant.variant}>
                        <td className="py-1.5 pr-2 font-mono text-slate-200">{variant.variant}</td>
                        <td className="py-1.5 pr-2 text-slate-300">{variant.count}</td>
                        <td className="py-1.5 pr-2 text-slate-300">
                          {variant.avg_confidence !== null ? `${Math.round(variant.avg_confidence * 100)}%` : "—"}
                        </td>
                        <td className="py-1.5 pr-2 text-amber-300">{variant.false_alarms}</td>
                        <td className="py-1.5 pr-2 text-slate-300">
                          {variant.avg_latency_sec !== null ? `${variant.avg_latency_sec} с` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ab.cameras.length === 0 ? (
                <p className="text-[10.5px] text-slate-500">
                  A/B пока не включён ни на одной камере. Настройте эксперимент в карточке камеры → «A/B моделей».
                </p>
              ) : (
                <div className="space-y-1">
                  {ab.cameras.map((camera) => (
                    <p key={camera.camera_id} className="text-[10.5px] text-slate-400">
                      {camera.camera_name}: {camera.profile_a} ↔ {camera.profile_b} · {camera.share_b}% кадров на B
                    </p>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 py-6 text-center">Пока нет данных A/B-теста</p>
          )}
        </SectionCard>
      </div>
      </div>
    </div>
  );
};
