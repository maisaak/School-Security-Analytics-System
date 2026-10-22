import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Eye,
  GraduationCap,
  KeyRound,
  Loader2,
  Lock,
  ScanEye,
  ShieldAlert,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { api, DemoAccount, Role } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const ROLE_META: Record<
  Role,
  {
    icon: React.ElementType;
    accent: string;
    ring: string;
    chip: string;
    bullets: string[];
  }
> = {
  admin: {
    icon: ShieldCheck,
    accent: "text-emerald-300",
    ring: "border-emerald-500/40 hover:border-emerald-400/80 hover:shadow-emerald-500/10",
    chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    bullets: [
      "Камеры: добавление, пауза, удаление",
      "Удаление улик и управление пользователями",
      "Дообучение YOLOv8 и откат весов",
      "Полный журнал аудита",
    ],
  },
  director: {
    icon: GraduationCap,
    accent: "text-sky-300",
    ring: "border-sky-500/40 hover:border-sky-400/80 hover:shadow-sky-500/10",
    chip: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    bullets: [
      "Живой просмотр и аналитика",
      "Фото и видео инцидентов, скачивание",
      "Подтверждение тревог",
      "Журнал аудита действий",
    ],
  },
  guard: {
    icon: ShieldAlert,
    accent: "text-amber-300",
    ring: "border-amber-500/40 hover:border-amber-400/80 hover:shadow-amber-500/10",
    chip: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    bullets: [
      "Видеостена КПП и тревоги",
      "Просмотр фото/видео нарушений",
      "Подтверждение отработки",
      "Проверка медиафайлов",
    ],
  },
};

export const LoginPage: React.FC = () => {
  const { login, demoLogin, error } = useAuth();
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [showPassword, setShowPassword] = useState(false);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    api.demoAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickLogin = async (account: DemoAccount) => {
    setLocalError(null);
    setBusyRole(account.role);
    setUsername(account.username);
    setPassword(account.password_hint);
    try {
      await demoLogin(account.username);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Ошибка быстрого входа");
    } finally {
      setBusyRole(null);
    }
  };

  const message = localError || error;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-32 w-[520px] h-[520px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute top-1/3 -right-40 w-[560px] h-[560px] rounded-full bg-indigo-500/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(#94a3b8 1px, transparent 1px), linear-gradient(90deg, #94a3b8 1px, transparent 1px)",
            backgroundSize: "42px 42px",
          }}
        />
      </div>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-10 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-6 space-y-8">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                School Security Analytics
              </h1>
              <p className="text-xs text-slate-400">Видеоаналитика школы · YOLOv8 · v2.0</p>
            </div>
          </div>

          <div className="space-y-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Контур безопасности · авторизация включена
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold text-white leading-tight">
              Единая видеостена, тревоги и аналитика школы
              <span className="block text-emerald-400 mt-1">в одном защищённом окне</span>
            </h2>
            <p className="text-sm text-slate-400 max-w-xl">
              JWT-сессия в HttpOnly cookie, ролевой доступ для администратора, директора и охраны,
              трекинг бесхозных предметов с таймером выдержки, реестр версий модели YOLOv8 и полный аудит.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl">
            {[
              { icon: ScanEye, title: "Живой MJPEG", text: "Камеры без задержек" },
              { icon: ShieldAlert, title: "Тревоги", text: "Выдержка 6 секунд" },
              { icon: BrainCircuit, title: "Validation Gate", text: "Откат при падении mAP@50" },
            ].map(({ icon: Icon, title, text }) => (
              <div
                key={title}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-3.5"
              >
                <Icon className="w-4 h-4 text-emerald-400 mb-2" />
                <p className="text-xs font-semibold text-white">{title}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{text}</p>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-2 text-[11px] text-slate-500 max-w-xl">
            <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-600" />
            <p>
              Cookie сессии помечена <span className="text-slate-400">HttpOnly</span> и{" "}
              <span className="text-slate-400">SameSite=Lax</span>. Пароли хранятся как PBKDF2-SHA256 (210 000
              итераций). Прямые ссылки на медиафайлы без сессии недоступны.
            </p>
          </div>
        </div>

        <div className="lg:col-span-6 w-full space-y-5">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 backdrop-blur-xl shadow-2xl shadow-black/40 p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-white">Вход в систему</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Быстрый вход по роли или учётные данные
                </p>
              </div>
              <KeyRound className="w-5 h-5 text-slate-500" />
            </div>

            <div className="space-y-2.5">
              {accounts.length === 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-500">
                  Демо-аккаунты не загружены — используйте форму логина ниже.
                </div>
              )}
              {accounts.map((account) => {
                const meta = ROLE_META[account.role];
                const Icon = meta.icon;
                return (
                  <button
                    key={account.username}
                    type="button"
                    disabled={busyRole !== null}
                    onClick={() => handleQuickLogin(account)}
                    className={`w-full text-left rounded-2xl border bg-slate-950/50 p-3.5 transition disabled:opacity-60 ${meta.ring}`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl bg-slate-900 border flex items-center justify-center ${meta.chip}`}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-white">{account.role_label}</span>
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${meta.chip}`}
                          >
                            {account.role}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">
                          {account.full_name} · <span className="font-mono">{account.username}</span> /{" "}
                          <span className="font-mono">{account.password_hint}</span>
                        </p>
                      </div>
                      {busyRole === account.role ? (
                        <Loader2 className="w-4 h-4 text-slate-300 animate-spin shrink-0" />
                      ) : (
                        <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">{account.description}</p>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3 my-5">
              <div className="h-px flex-1 bg-slate-800" />
              <span className="text-[10px] uppercase tracking-wider text-slate-600">или логин и пароль</span>
              <div className="h-px flex-1 bg-slate-800" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Логин</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/70 focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="admin"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Пароль</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-10 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500/70 focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-500 hover:text-slate-300"
                    tabIndex={-1}
                    title={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {message && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-200">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-sm font-semibold text-white transition shadow-lg shadow-emerald-950/40"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Войти в систему
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-3.5">
            <p className="text-[11px] font-medium text-slate-400 mb-2">Матрица прав ролей</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(Object.keys(ROLE_META) as Role[]).map((role) => {
                const meta = ROLE_META[role];
                const Icon = meta.icon;
                return (
                  <div key={role} className="rounded-xl bg-slate-950/50 border border-slate-800/80 p-2.5">
                    <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${meta.accent}`}>
                      <Icon className="w-3.5 h-3.5" />
                      {role === "admin" ? "Администратор" : role === "director" ? "Директор" : "Охранник"}
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {meta.bullets.slice(0, 3).map((bullet) => (
                        <li key={bullet} className="text-[10px] text-slate-500 leading-snug">
                          · {bullet}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
