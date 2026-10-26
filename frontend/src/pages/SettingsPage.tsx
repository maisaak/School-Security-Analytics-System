import React, { useEffect, useState } from "react";
import { api, Employee, ModelCatalog, Preferences, User } from "../api/client";

interface Props { user: User; preferences: Preferences; onPreferences: (value: Preferences) => void }
const input = "bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm w-full";
const roleName = { admin: "Администратор", operator: "Оператор", viewer: "Наблюдатель" };

export function SettingsPage({ user, preferences, onPreferences }: Props) {
  const [draft, setDraft] = useState(preferences);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [model, setModel] = useState("");
  const [download, setDownload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ username: "", display_name: "", password: "", role: "viewer" });
  const [resetId, setResetId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    api.modelCatalog().then(c => { setCatalog(c); setModel(c.models.find(m => m.filename === c.active_base)?.id ?? "yolov8n"); }).catch(e => setError(e.message));
    if (user.role === "admin") api.getEmployees().then(setEmployees).catch(e => setError(e.message));
  }, [user.role]);

  async function run(action: () => Promise<void>) {
    setError(null); setMessage(null); setBusy(true);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Ошибка сохранения"); }
    finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <h2 className="text-xl font-semibold">Настройки · {user.display_name} ({roleName[user.role]})</h2>
    {error && <p role="alert" className="bg-red-950 text-red-200 p-3 rounded-xl">{error}</p>}
    {message && <p role="status" className="bg-emerald-950 text-emerald-200 p-3 rounded-xl">{message}</p>}
    <fieldset disabled={busy} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <legend className="text-lg font-semibold">Мой интерфейс</legend>
      <p className="text-xs text-slate-400">Сохраняется на сервере отдельно для каждой учётной записи. Скрытие блока не меняет права доступа.</p>
      <label className="block text-sm">Колонок видеостены
        <select value={draft.columns} onChange={e => setDraft({ ...draft, columns: Number(e.target.value) as Preferences["columns"] })} className={input}>
          {[1,2,3,4].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label className="block text-sm">Стартовая страница
        <select value={draft.default_tab} onChange={e => setDraft({ ...draft, default_tab: e.target.value as Preferences["default_tab"] })} className={input}>
          <option value="dashboard">Мониторинг</option>
          {user.role !== "viewer" && <option value="lab">Лаборатория</option>}
          {user.role === "admin" && <option value="training">Обучение</option>}
          <option value="settings">Настройки</option>
        </select>
      </label>
      {([ ["show_stats", "Сводная статистика"], ["show_archive", "Журнал инцидентов"], ["show_alerts", "Баннер новых событий"], ["compact", "Компактный режим"] ] as const).map(([key,label]) =>
        <label key={key} className="flex items-center gap-3 text-sm"><input type="checkbox" checked={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.checked })} />{label}</label>
      )}
      {!draft.show_alerts && <p className="text-amber-300 text-xs">Баннер тревог будет скрыт; запись событий продолжится. Для поста охраны рекомендуем оставить его включённым.</p>}
      <button className="bg-indigo-600 rounded-lg px-4 py-2" onClick={() => run(async () => { const saved = await api.setPreferences(draft); onPreferences(saved); setMessage("Настройки интерфейса сохранены"); })}>Сохранить интерфейс</button>
    </fieldset>

    <fieldset disabled={busy || user.role !== "admin"} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <legend className="text-lg font-semibold">Версия YOLO</legend>
      <p className="text-sm">Базовая: <strong>{catalog?.active_base ?? "…"}</strong> · Кастомная: {catalog?.custom_weights ?? "не активирована"}</p>
      <p className="text-xs text-slate-400">Выбор общий для всех камер. YOLOv8 и YOLO11: N — быстрее и легче, X — тяжелее. Специализированный детектор оружия и кастомные веса остаются отдельными. Обучение новых кандидатов использует выбранную базу.</p>
      <select aria-label="Базовая модель YOLO" className={input} value={model} onChange={e => setModel(e.target.value)}>
        {catalog?.models.map(m => <option key={m.id} value={m.id}>{m.label} · {m.installed ? "установлена" : "нужна загрузка"}</option>)}
      </select>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={download} onChange={e => setDownload(e.target.checked)} />Разрешить загрузку официальных весов, если их нет на сервере</label>
      <button className="bg-indigo-600 rounded-lg px-4 py-2" onClick={() => run(async () => { setCatalog(await api.selectModel(model, download)); setMessage("Модель проверена и применена"); })}>{busy ? "Выполняется…" : "Применить модель"}</button>
    </fieldset>

    {user.role === "admin" && <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <h3 className="text-lg font-semibold">Доступ сотрудников</h3>
      <p className="text-xs text-slate-400">Наблюдатель: просмотр. Оператор: просмотр, проверка файлов и подтверждение инцидентов. Администратор: камеры, модели, обучение и сотрудники. Отключение, смена роли или пароля отзывает все сессии сотрудника.</p>
      <form className="grid md:grid-cols-2 gap-3" onSubmit={e => { e.preventDefault(); run(async () => { await api.createEmployee(newUser); setEmployees(await api.getEmployees()); setNewUser({ username: "", display_name: "", password: "", role: "viewer" }); setMessage("Сотрудник создан. Передайте логин и пароль безопасным способом."); }); }}>
        <input required aria-label="Логин сотрудника" placeholder="Логин: латиница, 3–64 символа" pattern="[a-z0-9][a-z0-9_.\-]{2,63}" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} className={input} />
        <input required aria-label="Имя сотрудника" placeholder="Имя сотрудника" value={newUser.display_name} onChange={e => setNewUser({ ...newUser, display_name: e.target.value })} className={input} />
        <input required type="password" minLength={12} maxLength={256} autoComplete="new-password" aria-label="Пароль сотрудника" placeholder="Пароль: минимум 12 символов" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} className={input} />
        <select aria-label="Роль нового сотрудника" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })} className={input}>{Object.entries(roleName).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>
        <button disabled={busy} className="bg-emerald-700 rounded-lg px-4 py-2">Создать сотрудника</button>
      </form>
      <div className="space-y-3">{employees.map(employee => <div key={employee.id} className="border-t border-slate-700 pt-3 flex flex-wrap items-center gap-3">
        <span className="flex-1">{employee.display_name} · {employee.username} {!employee.is_active && "(отключён)"}</span>
        <select disabled={busy || employee.id === user.id} aria-label={`Роль ${employee.username}`} className="bg-slate-950 p-2 rounded-lg" value={employee.role} onChange={e => { const role = e.target.value; run(async () => { await api.updateEmployee(employee.id, { role }); setEmployees(await api.getEmployees()); }); }}>{Object.entries(roleName).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>
        <button disabled={busy || employee.id === user.id} onClick={() => run(async () => { await api.updateEmployee(employee.id, { is_active: !employee.is_active }); setEmployees(await api.getEmployees()); })} className="border border-slate-600 rounded-lg p-2">{employee.is_active ? "Отключить" : "Включить"}</button>
        <button onClick={() => { setResetId(employee.id); setNewPassword(""); }} className="border border-slate-600 rounded-lg p-2">Новый пароль</button>
      </div>)}</div>
      {resetId !== null && <form className="flex gap-3" onSubmit={e => { e.preventDefault(); run(async () => { await api.updateEmployee(resetId, { password: newPassword }); setResetId(null); setNewPassword(""); setMessage("Пароль изменён, прежние сессии отозваны"); }); }}>
        <input required type="password" minLength={12} maxLength={256} autoComplete="new-password" aria-label="Новый пароль" placeholder="Новый пароль (12+ символов)" value={newPassword} onChange={e => setNewPassword(e.target.value)} className={input} />
        <button disabled={busy} className="bg-indigo-600 rounded-lg p-2">Сохранить</button><button type="button" onClick={() => setResetId(null)}>Отмена</button>
      </form>}
    </section>}
  </div>;
}
