import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccentName,
  api,
  KpiKey,
  Preferences,
  PreferencesPatch,
  ThemeName,
} from "../api/client";

export const KPI_KEYS: KpiKey[] = [
  "cameras",
  "violations",
  "critical",
  "dwell",
  "latency",
  "confidence",
];

export const KPI_LABELS: Record<KpiKey, { label: string; hint: string }> = {
  cameras: { label: "Камеры онлайн", hint: "Активные потоки и общее число камер" },
  violations: { label: "Нарушения", hint: "Всего срабатываний и очередь проверки" },
  critical: { label: "Критические", hint: "Оружие и бесхозные сумки" },
  dwell: { label: "Выдержка", hint: "Порог бесхозного предмета и активные треки" },
  latency: { label: "Задержка", hint: "Среднее время инференса YOLO" },
  confidence: { label: "Уверенность", hint: "Средняя уверенность детекций" },
};

export const THEME_LABELS: Record<ThemeName, string> = {
  dark: "Тёмная",
  light: "Светлая",
  contrast: "Контрастная",
};

export const ACCENT_LABELS: Record<AccentName, string> = {
  emerald: "Изумруд",
  indigo: "Индиго",
  sky: "Небо",
  amber: "Янтарь",
  rose: "Роза",
};

/** Цвета для кружков-переключателей в панели настроек. */
export const ACCENT_SWATCHES: Record<AccentName, string> = {
  emerald: "#10b981",
  indigo: "#6366f1",
  sky: "#0ea5e9",
  amber: "#f59e0b",
  rose: "#f43f5e",
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "dark",
  accent: "emerald",
  kpis: ["cameras", "violations", "dwell", "latency"],
  compact_tables: false,
  show_timeline: true,
  mobile_bottom_nav: true,
  sound_enabled: true,
  toasts_enabled: true,
};

const STORAGE_KEY = "school_security_prefs";

function normalize(raw: Partial<Preferences> | null | undefined): Preferences {
  const base = { ...DEFAULT_PREFERENCES };
  if (!raw) return base;
  const kpis = Array.isArray(raw.kpis)
    ? (raw.kpis.filter((k): k is KpiKey => KPI_KEYS.includes(k as KpiKey)) as KpiKey[])
    : [];
  return {
    ...base,
    ...raw,
    theme: (["dark", "light", "contrast"] as ThemeName[]).includes(raw.theme as ThemeName)
      ? (raw.theme as ThemeName)
      : base.theme,
    accent: (["emerald", "indigo", "sky", "amber", "rose"] as AccentName[]).includes(
      raw.accent as AccentName
    )
      ? (raw.accent as AccentName)
      : base.accent,
    kpis: kpis.length ? kpis : base.kpis,
    sound_enabled: raw.sound_enabled !== false,
    toasts_enabled: raw.toasts_enabled !== false,
  };
}

export function readCachedPreferences(): Preferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalize(raw ? (JSON.parse(raw) as Partial<Preferences>) : null);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Применяет тему к документу. Значения читаются из CSS-переменных в index.css,
 * поэтому достаточно переключить data-атрибуты на <html>.
 */
export function applyPreferences(prefs: Preferences): void {
  const root = document.documentElement;
  root.dataset.theme = prefs.theme;
  root.dataset.accent = prefs.accent;
  root.classList.add("prefs-ready");
}

function cachePreferences(prefs: Preferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // приватный режим — настройки просто не запомнятся между перезагрузками
  }
}

interface PrefsContextValue {
  prefs: Preferences;
  loading: boolean;
  saving: boolean;
  error: string | null;
  update: (patch: PreferencesPatch) => void;
  reset: () => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

export const PrefsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [prefs, setPrefs] = useState<Preferences>(() => readCachedPreferences());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedRef = useRef<Preferences>(prefs);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Пока настройки пришли с сервера, не отправляем их обратно
  const persistEnabledRef = useRef(false);

  // Тема применяется сразу, ещё до ответа сервера — без вспышки чужого оформления
  useEffect(() => {
    applyPreferences(prefs);
    cachePreferences(prefs);
  }, [prefs]);

  useEffect(() => {
    let cancelled = false;
    api
      .getPreferences()
      .then((remote) => {
        if (cancelled) return;
        const next = normalize(remote);
        savedRef.current = next;
        persistEnabledRef.current = false;
        setPrefs(next);
        cachePreferences(next);
        setError(null);
      })
      .catch(() => {
        // Сервер недоступен — работаем на локальном кэше, не мешая пользователю
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const persist = useCallback(async (next: Preferences) => {
    setSaving(true);
    try {
      const stored = await api.updatePreferences({
        theme: next.theme,
        accent: next.accent,
        kpis: next.kpis,
        compact_tables: next.compact_tables,
        show_timeline: next.show_timeline,
        mobile_bottom_nav: next.mobile_bottom_nav,
        sound_enabled: next.sound_enabled,
        toasts_enabled: next.toasts_enabled,
      });
      savedRef.current = normalize(stored);
      setError(null);
    } catch (err) {
      persistEnabledRef.current = false;
      setPrefs(savedRef.current);
      setError(err instanceof Error ? err.message : "Не удалось сохранить настройки");
    } finally {
      setSaving(false);
    }
  }, []);

  // Сохраняем на сервер только действия пользователя (не первоначальную загрузку)
  useEffect(() => {
    if (!persistEnabledRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void persist(prefs);
    }, 320);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [prefs, persist]);

  const update = useCallback((patch: PreferencesPatch) => {
    persistEnabledRef.current = true;
    setPrefs((current) => normalize({ ...current, ...patch }));
  }, []);

  const reset = useCallback(() => {
    persistEnabledRef.current = true;
    setPrefs({ ...DEFAULT_PREFERENCES });
  }, []);

  const value = useMemo<PrefsContextValue>(
    () => ({ prefs, loading, saving, error, update, reset }),
    [prefs, loading, saving, error, update, reset]
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
};

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) {
    throw new Error("usePrefs используется вне PrefsProvider");
  }
  return ctx;
}
