import React from "react";
import { AlertTriangle, Cpu, Gauge, Hourglass, Shield, ShieldAlert, Video } from "lucide-react";
import { DashboardStats, KpiKey } from "../api/client";
import { usePrefs } from "../prefs/PrefsContext";

interface StatsOverviewProps {
  stats: DashboardStats | null;
}

interface KpiCard {
  title: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  accent: string;
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({ stats }) => {
  const { prefs } = usePrefs();

  const totalThreats = Math.max(1, stats?.total_violations ?? 0);
  const weaponCount = stats?.by_type?.weapon ?? 0;
  const bagCount = stats?.by_type?.suspicious_bag ?? 0;
  const dogCount = stats?.by_type?.dog ?? 0;
  const dwell = stats?.tracking?.dwell_threshold_sec ?? 6;
  const confidence = stats?.average_confidence ?? 0;

  const cardsByKey: Record<KpiKey, KpiCard> = {
    cameras: {
      title: "Камеры онлайн",
      value: stats ? `${stats.active_cameras} / ${stats.total_cameras}` : "—",
      sub: "HLS-потоки с инференсом YOLO",
      icon: Video,
      accent: "text-brand-400 bg-brand-500/10 border-brand-500/25",
    },
    violations: {
      title: "Зафиксировано нарушений",
      value: stats ? String(stats.total_violations) : "—",
      sub: stats ? `Ожидают проверки: ${stats.unacknowledged_violations}` : "Журнал событий",
      icon: AlertTriangle,
      accent: "text-amber-400 bg-amber-500/10 border-amber-500/25",
    },
    critical: {
      title: "Критические инциденты",
      value: stats ? String(weaponCount + bagCount) : "—",
      sub: stats
        ? `Оружие: ${weaponCount} · бесхозные сумки: ${bagCount}`
        : "Оружие и бесхозные предметы",
      icon: ShieldAlert,
      accent: "text-red-400 bg-red-500/10 border-red-500/25",
    },
    dwell: {
      title: "Выдержка бесхозных",
      value: `${dwell.toFixed(0)} с`,
      sub: stats
        ? `В удержании: ${stats.tracking.bag_tracks_active} · ср. выдержка ${stats.tracking.avg_dwell_seconds.toFixed(1)} с`
        : "ByteTrack + таймер",
      icon: Hourglass,
      accent: "text-sky-400 bg-sky-500/10 border-sky-500/25",
    },
    latency: {
      title: "Задержка инференса",
      value: stats ? `${stats.model.avg_latency_ms.toFixed(0)} мс` : "—",
      sub: stats?.model.production_map50
        ? `${stats.model.production_version} · mAP@50 ${(stats.model.production_map50 * 100).toFixed(1)}%`
        : "Готов к анализу кадров",
      icon: Cpu,
      accent: "text-brand-400 bg-brand-500/10 border-brand-500/25",
    },
    confidence: {
      title: "Уверенность модели",
      value: stats && confidence > 0 ? `${(confidence * 100).toFixed(1)}%` : "—",
      sub: "Средняя уверенность детекций",
      icon: Gauge,
      accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
    },
  };

  const cards = prefs.kpis.map((key) => cardsByKey[key]).filter(Boolean);
  const gridCols =
    cards.length <= 1
      ? "xl:grid-cols-1"
      : cards.length === 2
      ? "xl:grid-cols-2"
      : cards.length === 3
      ? "xl:grid-cols-3"
      : "xl:grid-cols-4";

  const maxBucket = Math.max(1, ...(stats?.timeline?.map((b) => b.count) ?? [1]));
  const showTimeline = prefs.show_timeline;

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${gridCols} gap-3.5`}>
        {cards.map(({ title, value, sub, icon: Icon, accent }) => (
          <div
            key={title}
            className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex items-start justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-400">{title}</p>
              <p className="text-2xl font-bold text-ink mt-1 tracking-tight">{value}</p>
              <p className="text-[10px] text-slate-500 mt-1 leading-snug">{sub}</p>
            </div>
            <div className={`p-2.5 rounded-xl border shrink-0 ${accent}`}>
              <Icon className="w-4 h-4" />
            </div>
          </div>
        ))}
      </div>

      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
          <div
            className={`bg-slate-900/90 border border-slate-800 rounded-2xl p-4 ${
              showTimeline ? "lg:col-span-2" : "lg:col-span-3"
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Распределение детекций по классам угроз
              </span>
              <span className="text-[10px] text-slate-500">Всего записей: {stats.total_violations}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { label: "Оружие (weapon)", count: weaponCount, bar: "bg-red-500" },
                { label: "Бесхозные сумки", count: bagCount, bar: "bg-amber-500" },
                { label: "Собаки на территории", count: dogCount, bar: "bg-orange-500" },
              ].map((item) => (
                <div key={item.label} className="bg-slate-950/70 rounded-xl p-3 border border-slate-800/80">
                  <div className="flex justify-between text-[11px] mb-2">
                    <span className="text-slate-300 font-medium">{item.label}</span>
                    <span className="font-mono font-semibold text-ink">{item.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full ${item.bar} transition-all duration-500`}
                      style={{ width: `${Math.min(100, (item.count / totalThreats) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
              <Shield className="w-3.5 h-3.5 text-red-400/80" />
              Критические (оружие + бесхозные сумки):{" "}
              <span className="text-slate-300 font-mono">{weaponCount + bagCount}</span>
              <span className="text-slate-700">·</span>
              Средняя уверенность модели:{" "}
              <span className="text-slate-300 font-mono">
                {confidence > 0 ? `${(confidence * 100).toFixed(1)}%` : "—"}
              </span>
            </div>
          </div>

          {showTimeline && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Динамика событий (40 мин)
                </span>
                <span className="text-[10px] text-brand-400 font-mono">шаг 5м</span>
              </div>
              <div className="h-20 flex items-end gap-1.5 pt-2">
                {stats.timeline.map((bucket) => (
                  <div key={bucket.label} className="flex-1 flex flex-col items-center gap-1.5">
                    <div className="w-full bg-slate-950 rounded-md h-14 flex items-end p-0.5 border border-slate-800/70">
                      <div
                        className="w-full rounded-sm bg-brand-500/80 transition-all duration-500"
                        style={{
                          height: `${bucket.count === 0 ? 8 : Math.max(18, (bucket.count / maxBucket) * 100)}%`,
                          opacity: bucket.count === 0 ? 0.25 : 1,
                        }}
                        title={`${bucket.label}: ${bucket.count}`}
                      />
                    </div>
                    <span className="text-[9px] text-slate-500 font-mono">{bucket.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
