import React, { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  KeyRound,
  Loader2,
  Plus,
  Shield,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api, Role, User } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorNotice, formatDateTime, Pill, SectionCard, Spinner } from "../components/ui";

const ROLE_META: Record<Role, { label: string; icon: React.ElementType; tone: "emerald" | "sky" | "amber" }> = {
  admin: { label: "Администратор", icon: Shield, tone: "emerald" },
  director: { label: "Директор", icon: BadgeCheck, tone: "sky" },
  guard: { label: "Охранник", icon: ShieldAlert, tone: "amber" },
};

const ROLE_RIGHTS: Record<Role, string[]> = {
  admin: [
    "Управление камерами и их удаление",
    "Удаление улик и медиафайлов",
    "Дообучение YOLOv8 и откат весов",
    "Управление пользователями и аудит",
  ],
  director: [
    "Живой просмотр камер и аналитика",
    "Фото/видео инцидентов и скачивание",
    "Подтверждение тревог",
    "Журнал аудита",
  ],
  guard: [
    "Видеостена КПП",
    "Тревоги и подтверждение отработки",
    "Просмотр фото/видео нарушений",
    "Проверка медиафайлов",
  ],
};

const EMPTY_FORM = { username: "", password: "", full_name: "", role: "guard" as Role };

export const UsersPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await api.getUsers());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить пользователей");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createUser(form);
      setForm(EMPTY_FORM);
      setShowCreate(false);
      setNotice("Пользователь создан");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать пользователя");
    }
  };

  const handleRole = async (target: User, role: Role) => {
    setBusyId(target.id);
    try {
      await api.updateUser(target.id, { role });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить роль");
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (target: User) => {
    setBusyId(target.id);
    try {
      await api.updateUser(target.id, { is_active: !target.is_active });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить статус");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (target: User) => {
    setBusyId(target.id);
    try {
      await api.deleteUser(target.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить пользователя");
    } finally {
      setBusyId(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    try {
      await api.updateUser(resetTarget.id, { password: newPassword });
      setNotice(`Пароль пользователя @${resetTarget.username} обновлён`);
      setResetTarget(null);
      setNewPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сменить пароль");
    }
  };

  if (loading) return <Spinner label="Загрузка пользователей…" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" />
            Управление пользователями
          </h2>
          <p className="text-[11px] text-slate-400">
            Три роли с разграничением прав. Каждое изменение фиксируется в журнале аудита.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-[11px] font-medium text-white transition"
        >
          {showCreate ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showCreate ? "Отмена" : "Новый пользователь"}
        </button>
      </div>

      {error && <ErrorNotice message={error} onRetry={load} />}
      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200">
          <CheckCircle2 className="w-4 h-4" />
          {notice}
        </div>
      )}

      {showCreate && (
        <SectionCard title="Создание учётной записи" icon={UserPlus}>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">Логин (латиница)</label>
              <input
                required
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="ivanov"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">ФИО</label>
              <input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Иванов Иван"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">Пароль (мин. 6 символов)</label>
              <input
                required
                type="password"
                minLength={6}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">Роль</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="guard">Охранник</option>
                <option value="director">Директор</option>
                <option value="admin">Администратор</option>
              </select>
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white transition"
            >
              <Plus className="w-3.5 h-3.5" /> Создать
            </button>
          </form>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {(Object.keys(ROLE_META) as Role[]).map((role) => {
          const meta = ROLE_META[role];
          const Icon = meta.icon;
          return (
            <div key={role} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5">
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${role === "admin" ? "text-emerald-400" : role === "director" ? "text-sky-400" : "text-amber-400"}`} />
                <span className="text-xs font-semibold text-white">{meta.label}</span>
                <Pill tone={meta.tone} className="ml-auto">
                  {users.filter((u) => u.role === role).length}
                </Pill>
              </div>
              <ul className="space-y-1">
                {ROLE_RIGHTS[role].map((right) => (
                  <li key={right} className="text-[10px] text-slate-500 leading-snug">· {right}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <SectionCard title="Учётные записи" icon={Users}>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-left">
            <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-2">Пользователь</th>
                <th className="py-2.5 px-2">Роль</th>
                <th className="py-2.5 px-2">Статус</th>
                <th className="py-2.5 px-2">Последний вход</th>
                <th className="py-2.5 px-2 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {users.map((u) => {
                const meta = ROLE_META[u.role] ?? ROLE_META.guard;
                const Icon = meta.icon;
                const isSelf = u.id === currentUser?.id;
                return (
                  <tr key={u.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${u.role === "admin" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : u.role === "director" ? "bg-sky-500/15 text-sky-300 border-sky-500/30" : "bg-amber-500/15 text-amber-300 border-amber-500/30"}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] text-white font-medium truncate">
                            {u.full_name || u.username}
                            {isSelf && <span className="text-slate-500"> (вы)</span>}
                          </p>
                          <p className="text-[10px] font-mono text-slate-500">@{u.username}</p>
                        </div>
                        {u.is_demo && <Pill tone="indigo">демо</Pill>}
                      </div>
                    </td>
                    <td className="py-2.5 px-2">
                      <select
                        value={u.role}
                        disabled={busyId === u.id}
                        onChange={(e) => handleRole(u, e.target.value as Role)}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                      >
                        <option value="admin">Администратор</option>
                        <option value="director">Директор</option>
                        <option value="guard">Охранник</option>
                      </select>
                    </td>
                    <td className="py-2.5 px-2">
                      <button
                        onClick={() => handleToggleActive(u)}
                        disabled={busyId === u.id || isSelf}
                        title={isSelf ? "Нельзя отключить себя" : "Переключить статус"}
                        className={`px-2 py-0.5 rounded-full text-[10px] border transition disabled:opacity-50 ${
                          u.is_active
                            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                            : "bg-slate-800 text-slate-400 border-slate-700"
                        }`}
                      >
                        {u.is_active ? "активен" : "отключён"}
                      </button>
                    </td>
                    <td className="py-2.5 px-2 text-[10px] font-mono text-slate-500">
                      {u.last_login_at ? formatDateTime(u.last_login_at) : "—"}
                    </td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setResetTarget(u)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-slate-800 transition"
                          title="Сменить пароль"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={busyId === u.id || isSelf}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition disabled:opacity-30"
                          title={isSelf ? "Нельзя удалить себя" : "Удалить пользователя"}
                        >
                          {busyId === u.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleResetPassword}
            className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Новый пароль для @{resetTarget.username}
              </h3>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Минимум 6 символов"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition"
            >
              Сохранить пароль
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
