import React, { useCallback, useEffect, useRef } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

/* ── Тона ─────────────────────────────────────────────────────────────────
 * Все классы перечислены статически, чтобы Tailwind не вырезал их при сборке.
 */
export type Tone = "brand" | "emerald" | "amber" | "red" | "sky" | "indigo" | "slate";

const KPI_TONES: Record<Tone, { icon: string; bar: string; glow: string }> = {
  brand: {
    icon: "text-brand-300 bg-brand-500/10 border-brand-500/25",
    bar: "bg-brand-400",
    glow: "from-brand-500/[0.09]",
  },
  emerald: {
    icon: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25",
    bar: "bg-emerald-400",
    glow: "from-emerald-500/[0.09]",
  },
  amber: {
    icon: "text-amber-300 bg-amber-500/10 border-amber-500/25",
    bar: "bg-amber-400",
    glow: "from-amber-500/[0.09]",
  },
  red: {
    icon: "text-red-300 bg-red-500/10 border-red-500/25",
    bar: "bg-red-400",
    glow: "from-red-500/[0.09]",
  },
  sky: {
    icon: "text-sky-300 bg-sky-500/10 border-sky-500/25",
    bar: "bg-sky-400",
    glow: "from-sky-500/[0.09]",
  },
  indigo: {
    icon: "text-indigo-300 bg-indigo-500/10 border-indigo-500/25",
    bar: "bg-indigo-400",
    glow: "from-indigo-500/[0.09]",
  },
  slate: {
    icon: "text-slate-300 bg-slate-500/10 border-slate-500/25",
    bar: "bg-slate-400",
    glow: "from-slate-500/[0.08]",
  },
};

/* ── Заголовок страницы ───────────────────────────────────────────────── */

export const PageHeader: React.FC<{
  title: string;
  eyebrow?: string;
  description?: React.ReactNode;
  icon?: React.ElementType;
  tone?: Tone;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}> = ({ title, eyebrow, description, icon: Icon, tone = "brand", actions, meta }) => {
  const palette = KPI_TONES[tone];
  return (
    <header className="flex flex-col gap-4 border-b border-slate-800/70 pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3.5">
        {Icon && (
          <div
            className={`hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-inner sm:flex ${palette.icon}`}
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-400/80">
              {eyebrow}
            </p>
          )}
          <h1 className="text-xl font-bold leading-tight tracking-tight text-ink sm:text-[26px]">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-3xl text-[11.5px] leading-relaxed text-slate-400 sm:text-xs">
              {description}
            </p>
          )}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
};

/* ── Карточка раздела ─────────────────────────────────────────────────── */

export const SectionCard: React.FC<{
  title?: string;
  subtitle?: string;
  icon?: React.ElementType;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
}> = ({ title, subtitle, icon: Icon, actions, children, className = "", bodyClassName = "", flush = false }) => (
  <section className={`panel border border-slate-800 rounded-2xl ${flush ? "" : "p-4 sm:p-5"} ${className}`}>
    {(title || actions) && (
      <div
        className={`flex flex-wrap items-start justify-between gap-3 mb-4 ${
          flush ? "px-4 pt-4 sm:px-5" : ""
        }`}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          {Icon && (
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-brand-500/20 bg-brand-500/10 text-brand-300">
              <Icon className="h-3.5 w-3.5" />
            </span>
          )}
          <div className="min-w-0">
            {title && <h2 className="text-[13.5px] font-semibold leading-7 text-ink sm:text-sm">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    )}
    <div className={bodyClassName}>{children}</div>
  </section>
);

/* ── KPI ──────────────────────────────────────────────────────────────── */

export const KpiCard: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ElementType;
  tone?: Tone;
  trend?: { value: string; positive?: boolean };
  onClick?: () => void;
}> = ({ label, value, hint, icon: Icon, tone = "brand", trend, onClick }) => {
  const palette = KPI_TONES[tone];
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`panel panel-hover group relative overflow-hidden rounded-2xl border border-slate-800 p-4 text-left ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-70 ${palette.glow}`}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight text-ink tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-[10.5px] leading-snug text-slate-500">{hint}</p>}
          {trend && (
            <p
              className={`mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium ${
                trend.positive === false ? "text-amber-300" : "text-brand-300"
              }`}
            >
              {trend.value}
            </p>
          )}
        </div>
        {Icon && (
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${palette.icon}`}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <span
        className={`absolute inset-x-4 bottom-0 h-px opacity-40 transition-opacity group-hover:opacity-100 ${palette.bar}`}
      />
    </Tag>
  );
};

/* ── Мелкие элементы ──────────────────────────────────────────────────── */

export const Pill: React.FC<{
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}> = ({ tone = "slate", children, className = "" }) => {
  const tones: Record<string, string> = {
    brand: "bg-brand-500/15 text-brand-300 border-brand-500/35",
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/35",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/35",
    red: "bg-red-500/15 text-red-300 border-red-500/35",
    sky: "bg-sky-500/15 text-sky-300 border-sky-500/35",
    indigo: "bg-indigo-500/15 text-indigo-300 border-indigo-500/35",
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

export const Segmented: React.FC<{
  options: { value: string | number; label: string; icon?: React.ElementType }[];
  value: string | number;
  onChange: (value: any) => void;
  className?: string;
  ariaLabel?: string;
}> = ({ options, value, onChange, className = "", ariaLabel }) => (
  <div className={`segmented ${className}`} role="tablist" aria-label={ariaLabel}>
    {options.map(({ value: optionValue, label, icon: Icon }) => {
      const active = String(optionValue) === String(value);
      return (
        <button
          key={optionValue}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => onChange(optionValue)}
          className={`segment ${active ? "segment-active" : ""}`}
        >
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {label}
        </button>
      );
    })}
  </div>
);

/* ── Скелетоны ────────────────────────────────────────────────────────── */

export const Skeleton: React.FC<{ className?: string }> = ({ className = "" }) => (
  <div className={`skeleton ${className}`} aria-hidden="true" />
);

export const SkeletonCards: React.FC<{ count?: number; className?: string }> = ({
  count = 4,
  className = "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5",
}) => (
  <div className={className} aria-hidden="true">
    {Array.from({ length: count }).map((_, index) => (
      <div key={index} className="panel rounded-2xl border border-slate-800 p-4">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="mt-3 h-6 w-16" />
        <Skeleton className="mt-3 h-2 w-32" />
      </div>
    ))}
  </div>
);

export const SkeletonPanel: React.FC<{ rows?: number; className?: string }> = ({ rows = 4, className = "" }) => (
  <div className={`panel rounded-2xl border border-slate-800 p-4 sm:p-5 ${className}`} aria-hidden="true">
    <Skeleton className="h-3 w-40" />
    <div className="mt-4 space-y-2.5">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </div>
  </div>
);

/* ── Служебные состояния ──────────────────────────────────────────────── */

export const Spinner: React.FC<{ label?: string }> = ({ label }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-10 text-slate-500">
    <span className="relative flex h-9 w-9 items-center justify-center">
      <span className="absolute inset-0 rounded-full border border-brand-500/20" />
      <span className="absolute inset-0 animate-ping rounded-full border border-brand-500/20" />
      <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
    </span>
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
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-[11px] font-medium transition"
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
  action?: React.ReactNode;
}> = ({ icon: Icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
    {Icon && (
      <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/60">
        <Icon className="h-5 w-5 text-slate-500" />
      </span>
    )}
    <p className="text-sm font-medium text-slate-300">{title}</p>
    {description && <p className="max-w-md text-xs leading-relaxed text-slate-500">{description}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);

/* ── Форматирование ───────────────────────────────────────────────────── */

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
