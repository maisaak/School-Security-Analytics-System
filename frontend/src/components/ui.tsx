import React, { useCallback, useEffect, useRef } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

export const SectionCard: React.FC<{
  title?: string;
  subtitle?: string;
  icon?: React.ElementType;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, icon: Icon, actions, children, className = "" }) => (
  <section className={`bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 ${className}`}>
    {(title || actions) && (
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          {title && (
            <h2 className="text-sm sm:text-base font-semibold text-ink flex items-center gap-2">
              {Icon && <Icon className="w-4 h-4 text-brand-400" />}
              {title}
            </h2>
          )}
          {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
    )}
    {children}
  </section>
);

export const Pill: React.FC<{
  tone?: "emerald" | "amber" | "red" | "sky" | "indigo" | "slate";
  children: React.ReactNode;
  className?: string;
}> = ({ tone = "slate", children, className = "" }) => {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/35",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/35",
    red: "bg-red-500/15 text-red-300 border-red-500/35",
    sky: "bg-sky-500/15 text-sky-300 border-sky-500/35",
    indigo: "bg-brand-500/15 text-brand-300 border-brand-500/35",
    slate: "bg-slate-800/80 text-slate-300 border-slate-700",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
};

export const Spinner: React.FC<{ label?: string }> = ({ label }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-10 text-slate-500">
    <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
    {label && <p className="text-xs">{label}</p>}
  </div>
);

export const ErrorNotice: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
    <span className="flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      {message}
    </span>
    {onRetry && (
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-[11px] font-medium"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Повторить
      </button>
    )}
  </div>
);

export const EmptyState: React.FC<{
  icon?: React.ElementType;
  title: string;
  description?: string;
}> = ({ icon: Icon, title, description }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
    {Icon && <Icon className="w-8 h-8 text-slate-600" />}
    <p className="text-sm text-slate-300">{title}</p>
    {description && <p className="text-xs text-slate-500 max-w-md">{description}</p>}
  </div>
);

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("ru-RU");
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, idx)).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

/** Простой polling-хук с защитой от наложения запросов. */
export function usePolling(callback: () => Promise<void> | void, intervalMs: number) {
  const saved = useRef(callback);
  const running = useRef(false);
  saved.current = callback;

  const tick = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      await saved.current();
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    tick();
    const timer = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(timer);
  }, [tick, intervalMs]);

  return tick;
}
