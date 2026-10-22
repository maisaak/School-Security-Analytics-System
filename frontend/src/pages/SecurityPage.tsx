import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  Eye,
  KeyRound,
  Loader2,
  Lock,
  LockOpen,
  ScanFace,
  ShieldCheck,
  ShieldHalf,
  Users,
  Video,
} from "lucide-react";
import { api, Camera, SecurityOverview, User } from "../api/client";
import { ErrorNotice, formatDateTime, Pill, SectionCard, Spinner } from "../components/ui";

const ROLE_LABEL: Record<string, string> = {
  admin: "Администратор",
  director: "Директор",
  guard: "Охранник",
};

export const SecurityPage: React.FC = () => {
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scopeFor, setScopeFor] = useState<User | null>(null);
  const [scopeIds, setScopeIds] = useState<number[]>([]);

  const load = useCallback(async () => {
    try {
      const [overviewData, userList, cameraList] = await Promise.all([
        api.getSecurityOverview(),
        api.getUsers(),
        api.getCameras(),
      ]);
      setOverview(overviewData);
      setUsers(userList);
      setCameras(cameraList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить обзор безопасности");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    setNotice(null);
    setError(null);
    try {
      setNotice(await action());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Операция не выполнена");
    } finally {
      setBusy(null);
    }
  };

  const reset2fa = (user: User) =>
    act(`2fa-${user.id}`, async () => {
      await api.resetUserTwoFactor(user.id);
      return `2FA сброшена для @${user.username}`;
    });

  const unlock = (user: User) =>
    act(`unlock-${user.id}`, async () => {
      await api.unlockUser(user.id);
      return `Учётная запись @${user.username} разблокирована`;
    });

  const openScope = (user: User) => {
    setScopeFor(user);
    setScopeIds(user.camera_scope ?? []);
  };

  const saveScope = () =>
    act("scope", async () => {
      if (!scopeFor) return "";
      await api.setCameraScope(scopeFor.id, scopeIds);
      setScopeFor(null);
      return scopeIds.length === 0
        ? `@${scopeFor.username}: доступ ко всем камерам`
        : `@${scopeFor.username}: доступ к ${scopeIds.length} камерам`;
    });

  const lockedNames = useMemo(
    () => new Set((overview?.locked_accounts ?? []).map((item) => item.username)),
    [overview]
  );

  const uniqueCameraScopes = users.filter((user) => (user.camera_scope ?? []).length > 0);

  if (loading && !overview) return <Spinner label="Проверяем настройки безопасности…" />;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" /> Безопасность и доступ
        </h2>
        <p className="text-[11px] text-slate-400">
          Двухфакторная аутентификация, политика паролей, ограничение камер и журнал выгрузок
        </p>
      </div>

      {error && <ErrorNotice message={error} onRetry={load} />}
      {notice && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200 flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> {notice}
        </div>
      )}

      {overview && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            {[
              { label: "Учётные записи", value: overview.users_total, sub: `${overview.users_with_2fa} с 2FA`, icon: Users },
              { label: "Камеры", value: overview.cameras_total, sub: `${overview.users_restricted} с ограничениями`, icon: Video },
              { label: "Заблокированы", value: overview.locked_accounts.length, sub: `после ${overview.password_policy.lockout_attempts} попыток`, icon: Lock },
              { label: "Экспорты", value: overview.recent_exports.length, sub: "в журнале (последние 20)", icon: Download },
            ].map(({ label, value, sub, icon: Icon }) => (
              <div key={label} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-400">{label}</p>
                  <p className="text-2xl font-bold text-ink mt-1">{value}</p>
                  <p className="text-[10px] text-slate-500 truncate">{sub}</p>
                </div>
                <div className="p-2 rounded-xl border border-slate-700 bg-slate-800/50 text-emerald-300 shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <SectionCard title="Политика паролей" subtitle="Применяется при смене пароля" icon={KeyRound}>
              <div className="space-y-1.5 text-[11px] text-slate-300">
                <div className="flex justify-between gap-2">
                  <span>Минимальная длина</span>
                  <span className="font-mono text-slate-100">{overview.password_policy.min_length}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Заглавные и строчные</span>
                  <Pill tone={overview.password_policy.requires_upper ? "emerald" : "slate"}>обязательно</Pill>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Цифры</span>
                  <Pill tone={overview.password_policy.requires_digit ? "emerald" : "slate"}>обязательно</Pill>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Блокировка аккаунта</span>
                  <span className="text-slate-300">
                    {overview.password_policy.lockout_attempts} попыток / {overview.password_policy.lockout_minutes} мин
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Rate limit входа</span>
                  <span className="text-slate-300">
                    {overview.password_policy.rate_limit_attempts} / {overview.password_policy.rate_limit_window_sec} с
                  </span>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Неудачные входы" subtitle="Последние 10 событий аутентификации" icon={ShieldHalf}>
              <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                {(overview.recent_failures ?? []).length === 0 && (
                  <p className="text-[11px] text-slate-500">Неудачных попыток не зафиксировано</p>
                )}
                {overview.recent_failures.map((item, index) => (
                  <div key={index} className="flex items-center justify-between gap-2 text-[10.5px]">
                    <span className="text-slate-300 truncate">
                      {item.actor ?? "неизвестный"} · {item.action}
                    </span>
                    <span className="text-slate-500 font-mono shrink-0">{formatDateTime(item.created_at)}</span>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Журнал выгрузок" subtitle="Кто и когда скачивал кадры и отчёты" icon={Eye}>
              <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                {(overview.recent_exports ?? []).length === 0 && (
                  <p className="text-[11px] text-slate-500">Выгрузок пока не было</p>
                )}
                {overview.recent_exports.map((item, index) => (
                  <div key={index} className="text-[10.5px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-300 truncate">
                        {item.actor ?? "—"} · {item.action}
                      </span>
                      <span className="text-slate-500 font-mono shrink-0">{formatDateTime(item.created_at)}</span>
                    </div>
                    <p className="text-[9.5px] text-slate-500 truncate">{item.detail}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          <SectionCard
            title="Учётные записи: 2FA и доступ к камерам"
            subtitle="Пустой список камер означает доступ ко всем камерам"
            icon={ScanFace}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-[9.5px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <tr>
                    <th className="py-2 pr-2">Пользователь</th>
                    <th className="py-2 pr-2">Роль</th>
                    <th className="py-2 pr-2">2FA</th>
                    <th className="py-2 pr-2">Камеры</th>
                    <th className="py-2 pr-2">Статус</th>
                    <th className="py-2 pr-2 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {users.map((user) => {
                    const locked = lockedNames.has(user.username);
                    return (
                      <tr key={user.id} className="hover:bg-slate-800/30">
                        <td className="py-2 pr-2">
                          <p className="text-slate-100 font-medium">{user.full_name}</p>
                          <p className="text-[9.5px] text-slate-500 font-mono">@{user.username}</p>
                        </td>
                        <td className="py-2 pr-2 text-slate-300">{ROLE_LABEL[user.role] ?? user.role}</td>
                        <td className="py-2 pr-2">
                          <Pill tone={user.totp_enabled ? "emerald" : "amber"}>
                            {user.totp_enabled ? "включена" : "выключена"}
                          </Pill>
                        </td>
                        <td className="py-2 pr-2 text-slate-300">
                          {(user.camera_scope ?? []).length === 0 ? "все" : `${(user.camera_scope ?? []).length} шт.`}
                        </td>
                        <td className="py-2 pr-2">
                          {locked ? <Pill tone="red">заблокирована</Pill> : <Pill tone="emerald">активна</Pill>}
                        </td>
                        <td className="py-2 pr-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => openScope(user)}
                              title="Ограничить доступ к камерам"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-sky-500/10"
                            >
                              <Video className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => reset2fa(user)}
                              disabled={!user.totp_enabled || busy === `2fa-${user.id}`}
                              title="Сбросить 2FA (потребуется настроить заново)"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-amber-500/10 disabled:opacity-30"
                            >
                              {busy === `2fa-${user.id}` ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <KeyRound className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              onClick={() => unlock(user)}
                              disabled={!locked || busy === `unlock-${user.id}`}
                              title="Снять блокировку после неудачных попыток"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-30"
                            >
                              <LockOpen className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {uniqueCameraScopes.length > 0 && (
              <p className="text-[10px] text-slate-500 mt-2">
                Ограничения:{" "}
                {uniqueCameraScopes
                  .map((user) => `@${user.username} → ${(user.camera_scope ?? []).length} камер`)
                  .join(" · ")}
              </p>
            )}
          </SectionCard>
        </>
      )}

      {scopeFor && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">Доступ к камерам</h3>
                <p className="text-[11px] text-slate-400">
                  @{scopeFor.username} · {scopeFor.full_name}
                </p>
              </div>
              <button onClick={() => setScopeFor(null)} className="text-slate-400 hover:text-ink">
                ✕
              </button>
            </div>
            <p className="text-[10.5px] text-slate-500">
              Снимите все галочки, чтобы вернуть доступ ко всем камерам. Пользователь увидит только
              разрешённые потоки и инциденты с них.
            </p>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {cameras.map((camera) => {
                const checked = scopeIds.includes(camera.id);
                return (
                  <label
                    key={camera.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2 text-[11px] text-slate-300 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setScopeIds((prev) =>
                          e.target.checked ? [...prev, camera.id] : prev.filter((id) => id !== camera.id)
                        )
                      }
                      className="rounded accent-brand-500"
                    />
                    <span className="min-w-0 flex-1 truncate">{camera.name}</span>
                    <span className="text-[9.5px] text-slate-500 truncate max-w-[45%]">{camera.location}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => setScopeIds([])}
                className="text-[10.5px] text-slate-400 hover:text-ink underline decoration-dotted"
              >
                Все камеры
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setScopeFor(null)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200"
                >
                  Отмена
                </button>
                <button
                  onClick={saveScope}
                  disabled={busy === "scope"}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-[11px] text-white disabled:opacity-60"
                >
                  {busy === "scope" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
