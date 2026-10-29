import React from "react";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { DashboardStats } from "../api/client";

interface StatsOverviewProps {
  stats: DashboardStats | null;
  detailed?: boolean;
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({ stats, detailed = false }) => {
  const totalThreats = Math.max(1, stats?.total_violations ?? 0);
  const confirmedCount = stats?.confirmed_violations ?? 0;
  const pendingCount = stats?.pending_violations ?? 0;

  const cards = [
    {
      title: "Всего зафиксировано",
      value: stats ? String(stats.total_violations) : "—",
      sub: "Все события в архиве",
      icon: AlertTriangle,
      accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
    },
    {
      title: "Подтверждено",
      value: stats ? String(confirmedCount) : "—",
      sub: "Обработаны оператором",
      icon: CheckCircle2,
      accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
    },
    {
      title: "Ждут обработки",
      value: stats ? String(pendingCount) : "—",
      sub: "Новые и на проверке",
      icon: Clock,
      accent: "text-amber-400 bg-amber-500/10 border-amber-500/25",
    },
    {
      title: "Доля подтверждённых",
      value: stats && stats.total_violations ? `${Math.round((confirmedCount / stats.total_violations) * 100)}%` : "—",
      sub: "От всех зафиксированных событий",
      icon: CheckCircle2,
      accent: "text-indigo-400 bg-indigo-500/10 border-indigo-500/25",
    },
  ];

  const maxBucket = Math.max(1, ...(stats?.timeline?.map((b) => b.count) ?? [1]));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map(({ title, value, sub, icon: Icon, accent }) => (
          <div
            key={title}
            className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex items-start justify-between gap-3"
          >
            <div>
              <p className="text-xs font-medium text-slate-400">{title}</p>
              <p className="text-2xl font-bold text-white mt-1.5 tracking-tight">{value}</p>
              <p className="text-xs text-slate-500 mt-1">{sub}</p>
            </div>
            <div className={`p-2.5 rounded-xl border ${accent}`}>
              <Icon className="w-5 h-5" />
            </div>
          </div>
        ))}
      </div>

      {detailed && stats && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Распределение детекций по классам угроз
              </span>
              <span className="text-xs text-slate-500">Всего записей: {stats.total_violations}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: "Подтверждено", count: confirmedCount, bar: "bg-emerald-500" },
                { label: "Ждут обработки", count: pendingCount, bar: "bg-amber-500" },
                { label: "Ложные тревоги", count: stats.false_alarm_violations ?? 0, bar: "bg-slate-500" },
              ].map((item) => (
                <div key={item.label} className="bg-slate-950/70 rounded-xl p-3 border border-slate-800/80">
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-slate-300 font-medium">{item.label}</span>
                    <span className="font-mono font-semibold text-white">{item.count}</span>
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
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Динамика событий (40 мин)
              </span>
              <span className="text-xs text-indigo-400 font-mono">Интервал 5м</span>
            </div>
            <div className="h-20 flex items-end gap-2 pt-2">
              {stats.timeline.map((bucket) => (
                <div key={bucket.label} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="w-full bg-slate-950 rounded-md h-14 flex items-end p-0.5 border border-slate-800/70">
                    <div
                      className="w-full rounded-sm bg-indigo-500/80 transition-all duration-500"
                      style={{
                        height: `${(bucket.count / maxBucket) * 100}%`,
                        opacity: bucket.count === 0 ? 0.25 : 1,
                      }}
                      title={`${bucket.label}: ${bucket.count}`}
                    />
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">{bucket.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
