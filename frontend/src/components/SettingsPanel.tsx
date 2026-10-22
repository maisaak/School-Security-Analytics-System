import React, { useEffect, useState } from "react";
import {
  BellRing,
  Check,
  Copy,
  KeyRound,
  LayoutGrid,
  Loader2,
  Moon,
  Palette,
  RotateCcw,
  Rows3,
  ShieldCheck,
  Smartphone,
  Sun,
  SunDim,
  Volume2,
  X,
} from "lucide-react";
import { AccentName, api, KpiKey, ThemeName } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  ACCENT_LABELS,
  ACCENT_SWATCHES,
  KPI_LABELS,
  KPI_KEYS,
  THEME_LABELS,
  usePrefs,
} from "../prefs/PrefsContext";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const THEME_ICONS: Record<ThemeName, React.ElementType> = {
  dark: Moon,
  light: Sun,
  contrast: SunDim,
};

const Toggle: React.FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
  icon: React.ElementType;
}> = ({ checked, onChange, label, hint, icon: Icon }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
      checked
        ? "border-brand-500/50 bg-brand-500/10"
        : "border-slate-800 bg-slate-950/60 hover:bg-slate-800/40"
    }`}
  >
    <span
      className={`p-2 rounded-lg border shrink-0 ${
        checked
          ? "bg-brand-500/15 border-brand-500/30 text-brand-300"
          : "bg-slate-900 border-slate-800 text-slate-400"
      }`}
    >
      <Icon className="w-4 h-4" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-[11px] font-medium text-ink">{label}</span>
      <span className="block text-[10px] text-slate-500 leading-snug">{hint}</span>
    </span>
    <span
      className={`relative w-9 h-5 rounded-full transition shrink-0 ${
        checked ? "bg-brand-600" : "bg-slate-700"
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
          checked ? "left-[18px]" : "left-0.5"
        }`}
      />
    </span>
  </button>
);

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ open, onClose }) => {
  const { prefs, update, reset, saving, error } = usePrefs();
  const { user, can } = useAuth();
  const [twoFa, setTwoFa] = useState<{ enabled: boolean; recovery_codes_left: number } | null>(null);
  const [setupData, setSetupData] = useState<{ secret: string; otpauth_uri: string; recovery_codes: string[] } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [twoFaBusy, setTwoFaBusy] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const [twoFaNotice, setTwoFaNotice] = useState<string | null>(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [showDisable, setShowDisable] = useState(false);

  useEffect(() => {
    if (!open) return;
    api
      .twoFactorStatus()
      .then(setTwoFa)
      .catch(() => setTwoFa(null));
  }, [open, user?.totp_enabled]);

  const startTwoFa = async () => {
    setTwoFaBusy(true);
    setTwoFaError(null);
    try {
      const data = await api.setupTwoFactor();
      setSetupData(data);
    } catch (err) {
      setTwoFaError(err instanceof Error ? err.message : "Не удалось начать настройку 2FA");
    } finally {
      setTwoFaBusy(false);
    }
  };

  const confirmTwoFa = async () => {
    setTwoFaBusy(true);
    setTwoFaError(null);
    try {
      await api.enableTwoFactor(totpCode.trim());
      setTwoFaNotice("Двухфакторная аутентификация включена");
      setSetupData(null);
      setTotpCode("");
      setTwoFa(await api.twoFactorStatus());
    } catch (err) {
      setTwoFaError(err instanceof Error ? err.message : "Неверный код");
    } finally {
      setTwoFaBusy(false);
    }
  };

  const stopTwoFa = async () => {
    setTwoFaBusy(true);
    setTwoFaError(null);
    try {
      await api.disableTwoFactor(disablePassword);
      setTwoFaNotice("2FA отключена");
      setShowDisable(false);
      setDisablePassword("");
      setTwoFa(await api.twoFactorStatus());
    } catch (err) {
      setTwoFaError(err instanceof Error ? err.message : "Не удалось отключить 2FA");
    } finally {
      setTwoFaBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggleKpi = (key: KpiKey) => {
    const has = prefs.kpis.includes(key);
    if (has && prefs.kpis.length === 1) return; // хотя бы один KPI должен остаться
    const next = has ? prefs.kpis.filter((k) => k !== key) : [...prefs.kpis, key];
    // Сохраняем порядок эталонного списка, чтобы карточки не «прыгали»
    update({ kpis: KPI_KEYS.filter((k) => next.includes(k)) });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/60">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-800 bg-slate-900/95 backdrop-blur px-4 sm:px-6 py-3.5">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-ink flex items-center gap-2">
              <Palette className="w-4 h-4 text-brand-400" />
              Настройки интерфейса
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Оформление и набор показателей сохраняются в вашем профиле
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800 transition"
            aria-label="Закрыть настройки"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-4 space-y-5">
          {/* ── Тема ─────────────────────────────────────────────────────── */}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Тема страницы
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(THEME_LABELS) as ThemeName[]).map((theme) => {
                const Icon = THEME_ICONS[theme];
                const active = prefs.theme === theme;
                return (
                  <button
                    key={theme}
                    type="button"
                    onClick={() => update({ theme })}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-[11px] font-medium transition ${
                      active
                        ? "border-brand-500/60 bg-brand-500/10 text-brand-200"
                        : "border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800/40"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {THEME_LABELS[theme]}
                    {active && <Check className="w-3 h-3 text-brand-400" />}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Акцент ───────────────────────────────────────────────────── */}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Цвет акцента
            </h3>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ACCENT_LABELS) as AccentName[]).map((accent) => {
                const active = prefs.accent === accent;
                return (
                  <button
                    key={accent}
                    type="button"
                    onClick={() => update({ accent })}
                    className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-[11px] transition ${
                      active
                        ? "border-slate-400 bg-slate-800 text-ink"
                        : "border-slate-800 bg-slate-950/60 text-slate-300 hover:bg-slate-800/40"
                    }`}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-black/20"
                      style={{ backgroundColor: ACCENT_SWATCHES[accent] }}
                    />
                    {ACCENT_LABELS[accent]}
                    {active && <Check className="w-3 h-3" />}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── KPI ──────────────────────────────────────────────────────── */}
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Показатели на дашборде
            </h3>
            <p className="text-[10px] text-slate-500 mb-2">
              Выберите, какие карточки показывать на главном экране
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {KPI_KEYS.map((key) => {
                const active = prefs.kpis.includes(key);
                const isLast = active && prefs.kpis.length === 1;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleKpi(key)}
                    disabled={isLast}
                    title={isLast ? "Должен остаться хотя бы один показатель" : KPI_LABELS[key].hint}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition ${
                      active
                        ? "border-brand-500/50 bg-brand-500/10"
                        : "border-slate-800 bg-slate-950/60 hover:bg-slate-800/40"
                    } ${isLast ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    <span
                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                        active
                          ? "bg-brand-600 border-brand-600 text-white"
                          : "border-slate-600 bg-slate-900"
                      }`}
                    >
                      {active && <Check className="w-3 h-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-medium text-ink">
                        {KPI_LABELS[key].label}
                      </span>
                      <span className="block text-[9px] text-slate-500 truncate">
                        {KPI_LABELS[key].hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Интерфейс ────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Удобство работы
            </h3>
            <Toggle
              checked={prefs.compact_tables}
              onChange={(compact_tables) => update({ compact_tables })}
              label="Компактные таблицы"
              hint="Меньше высота строк — на экран помещается больше инцидентов"
              icon={Rows3}
            />
            <Toggle
              checked={prefs.show_timeline}
              onChange={(show_timeline) => update({ show_timeline })}
              label="График динамики событий"
              hint="Блок с распределением срабатываний за последние 40 минут"
              icon={LayoutGrid}
            />
            <Toggle
              checked={prefs.mobile_bottom_nav}
              onChange={(mobile_bottom_nav) => update({ mobile_bottom_nav })}
              label="Мобильная нижняя навигация"
              hint="Закреплённое меню внизу экрана на телефоне"
              icon={Smartphone}
            />
          </section>

          {/* ── Звук и уведомления ───────────────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Оповещения о тревогах
            </h3>
            <Toggle
              checked={prefs.sound_enabled}
              onChange={(sound_enabled) => update({ sound_enabled })}
              label="Звуковой сигнал тревоги"
              hint="Короткий тон при новом инциденте; повторяется, пока тревога не подтверждена"
              icon={Volume2}
            />
            <Toggle
              checked={prefs.toasts_enabled}
              onChange={(toasts_enabled) => update({ toasts_enabled })}
              label="Всплывающие уведомления"
              hint="Карточка нового инцидента в углу экрана со ссылкой на кадр"
              icon={BellRing}
            />
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Счётчик неподтверждённых тревог также дублируется в заголовке вкладки браузера — удобно,
              когда вкладка свёрнута. Кнопка «Включить звук» может потребоваться один раз: браузеры
              блокируют автовоспроизведение до первого взаимодействия.
            </p>
          </section>

          {/* ── Двухфакторная аутентификация ─────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Безопасность учётной записи
            </h3>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-medium text-ink flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    Двухфакторная аутентификация (TOTP)
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {twoFa?.enabled
                      ? `Включена · резервных кодов осталось: ${twoFa.recovery_codes_left}`
                      : "Google Authenticator, Aegis, 1Password и совместимые приложения"}
                  </p>
                </div>
                <span
                  className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded border shrink-0 ${
                    twoFa?.enabled
                      ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                      : "text-amber-300 border-amber-500/30 bg-amber-500/10"
                  }`}
                >
                  {twoFa?.enabled ? "включена" : "выключена"}
                </span>
              </div>

              {!twoFa?.enabled && !setupData && (
                <button
                  onClick={startTwoFa}
                  disabled={twoFaBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-[11px] text-white disabled:opacity-60"
                >
                  {twoFaBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                  Настроить 2FA
                </button>
              )}

              {setupData && (
                <div className="space-y-2 rounded-lg border border-brand-500/30 bg-brand-500/5 p-2.5">
                  <p className="text-[10px] text-slate-300">
                    1. Добавьте ключ в приложение-аутентификатор (вручную или по ссылке):
                  </p>
                  <div className="flex items-center gap-1.5">
                    <code className="flex-1 text-[10.5px] font-mono text-brand-200 bg-slate-950 rounded px-2 py-1.5 break-all">
                      {setupData.secret}
                    </code>
                    <button
                      onClick={() => navigator.clipboard?.writeText(setupData.secret)}
                      className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-ink shrink-0"
                      title="Скопировать секрет"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <details className="text-[10px] text-slate-500">
                    <summary className="cursor-pointer">Ссылка otpauth:// и резервные коды</summary>
                    <p className="font-mono break-all mt-1 text-slate-400">{setupData.otpauth_uri}</p>
                    <div className="grid grid-cols-2 gap-1 mt-1.5">
                      {setupData.recovery_codes.map((code) => (
                        <code key={code} className="font-mono text-slate-300 bg-slate-950 rounded px-1.5 py-0.5">
                          {code}
                        </code>
                      ))}
                    </div>
                    <p className="text-amber-300/80 mt-1">Сохраните резервные коды: они одноразовые.</p>
                  </details>
                  <p className="text-[10px] text-slate-300">2. Введите код из приложения:</p>
                  <div className="flex items-center gap-1.5">
                    <input
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      inputMode="numeric"
                      className="w-24 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-center font-mono tracking-widest text-[12px] text-slate-100"
                    />
                    <button
                      onClick={confirmTwoFa}
                      disabled={twoFaBusy || totpCode.length < 6}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[11px] text-white disabled:opacity-50"
                    >
                      Подтвердить
                    </button>
                  </div>
                </div>
              )}

              {twoFa?.enabled && !showDisable && (
                <button
                  onClick={() => setShowDisable(true)}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 text-[10.5px] text-slate-300 hover:bg-slate-800"
                >
                  Отключить 2FA
                </button>
              )}
              {showDisable && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    placeholder="Текущий пароль"
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-200"
                  />
                  <button
                    onClick={stopTwoFa}
                    disabled={twoFaBusy || !disablePassword}
                    className="px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-[10.5px] text-white disabled:opacity-50"
                  >
                    Подтвердить
                  </button>
                  <button
                    onClick={() => {
                      setShowDisable(false);
                      setDisablePassword("");
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-[10.5px] text-slate-300"
                  >
                    Отмена
                  </button>
                </div>
              )}

              {twoFaNotice && <p className="text-[10px] text-emerald-300">{twoFaNotice}</p>}
              {twoFaError && <p className="text-[10px] text-red-300">{twoFaError}</p>}
            </div>

            {can("security:manage") && (
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Политика паролей и блокировка после неудачных попыток применяются автоматически.
                Сброс 2FA и разблокировка других учётных записей — в разделе «Безопасность и 2FA».
              </p>
            )}
          </section>

          {error && (
            <p className="text-[11px] text-red-300 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-900/95 backdrop-blur px-4 sm:px-6 py-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-700 text-[11px] text-slate-300 hover:bg-slate-800 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Сбросить
          </button>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-500 inline-flex items-center gap-1.5">
              {saving ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" /> Сохраняем…
                </>
              ) : (
                <>
                  <Check className="w-3 h-3 text-emerald-400" /> Настройки сохранены
                </>
              )}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-xs font-medium text-white transition"
            >
              Готово
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
