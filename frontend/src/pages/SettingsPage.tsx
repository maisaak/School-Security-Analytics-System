import React, { useEffect, useState } from "react";
import { api, AuditEntry, Diagnostics, Employee, ModelCatalog, Preferences, User } from "../api/client";
import { CustomSelect } from "../components/CustomSelect";
import { ColorWheel } from "../components/ColorWheel";

interface Props { user: User; preferences: Preferences; onPreferences: (value: Preferences) => void }
const input = "custom-input";
const roleName = { admin: "Администратор", operator: "Охрана", viewer: "Директор" };

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
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  useEffect(() => {
    api.modelCatalog().then(c => { setCatalog(c); setModel(c.models.find(m => m.filename === c.active_base)?.id ?? "yolov8n"); }).catch(e => setError(e.message));
    if (user.role === "admin") api.getEmployees().then(setEmployees).catch(e => setError(e.message));
    if (user.role === "admin") api.getAudit(100).then(setAudit).catch(e => setError(e.message));
    if (user.role === "admin") api.getDiagnostics().then(setDiagnostics).catch(e => setError(e.message));
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
      <div className="settings-panel-title">Мой интерфейс</div>
      <p className="text-xs text-slate-400">Сохраняется на сервере отдельно для каждой учётной записи. Скрытие блока не меняет права доступа.</p>
      <label className="block text-sm">Колонок видеостены
        <CustomSelect value={draft.columns} onChange={value => setDraft({ ...draft, columns: value as Preferences["columns"] })} options={[1,2,3,4].map(n => ({ value: n as Preferences["columns"], label: `${n} колон${n === 1 ? "ка" : "ки"}` }))} />
      </label>
      <label className="block text-sm">Стартовая страница
        <CustomSelect value={draft.default_tab} onChange={value => setDraft({ ...draft, default_tab: value as Preferences["default_tab"] })} options={[{ value: "dashboard", label: "Обзор" }, { value: "monitoring", label: "Мониторинг" }, { value: "analytics", label: "Аналитика" }, ...(user.role !== "viewer" ? [{ value: "lab", label: "Лаборатория" }] : []), ...(user.role === "admin" ? [{ value: "training", label: "Обучение" }] : []), { value: "settings", label: "Настройки" }]} />
      </label>
      <div className="settings-subsection"><h3>Внешний вид</h3><p className="text-xs text-slate-400">Настройки сохраняются только для текущей учётной записи.</p></div>
      <label className="custom-check-row"><input className="custom-checkbox" type="checkbox" checked={draft.liquid_glass} onChange={e => setDraft({ ...draft, liquid_glass: e.target.checked })} /><span>Liquid Glass — стеклянные панели</span></label>
      <label className="block text-sm">Прозрачность панелей <strong>{draft.transparency}%</strong><input className="modern-range" type="range" min={0} max={70} disabled={!draft.liquid_glass} value={draft.transparency} style={{ "--range-progress": `${draft.transparency / 70 * 100}%` } as React.CSSProperties} onChange={e => setDraft({ ...draft, transparency: Number(e.target.value) })} /><span className="text-xs text-slate-400">0% — непрозрачные панели; 70% — максимальная прозрачность. Нажмите «Сохранить интерфейс», чтобы применить.</span></label>
      <label className="block text-sm">Тема<CustomSelect value={draft.theme} onChange={value => setDraft({ ...draft, theme: value as Preferences["theme"] })} options={[{ value: "dark", label: "Тёмная", hint: "Глубокий фон для поста наблюдения" }, { value: "light", label: "Светлая", hint: "Для хорошо освещённых помещений" }, { value: "system", label: "Как в системе", hint: "Следовать настройкам Windows" }]} /></label>
      <div className="block text-sm"><span>Акцентный цвет</span><ColorWheel value={draft.accent} onChange={accent => setDraft({ ...draft, accent })} /></div>
      <label className="block text-sm">Скругление блоков<CustomSelect value={draft.rounding} onChange={value => setDraft({ ...draft, rounding: value as Preferences["rounding"] })} options={[{ value: "none", label: "Без скругления" }, { value: "small", label: "Небольшое" }, { value: "large", label: "Выраженное" }]} /></label>
      {([ ["show_stats", "Сводная статистика"], ["show_archive", "Журнал инцидентов"], ["show_alerts", "Баннер новых событий"], ["compact", "Компактный режим"] ] as const).map(([key,label]) =>
         <label key={key} className="custom-check-row"><input className="custom-checkbox" type="checkbox" checked={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.checked })} /><span>{label}</span></label>
      )}
      <label className="custom-check-row"><input className="custom-checkbox" type="checkbox" checked={draft.animations} onChange={e => setDraft({ ...draft, animations: e.target.checked })} /><span>Плавные анимации и переходы</span></label>
      {!draft.show_alerts && <p className="text-amber-300 text-xs">Баннер тревог будет скрыт; запись событий продолжится. Для поста охраны рекомендуем оставить его включённым.</p>}
      <button className="bg-indigo-600 rounded-lg px-4 py-2" onClick={() => run(async () => { const saved = await api.setPreferences(draft); onPreferences(saved); setMessage("Настройки интерфейса сохранены"); })}>Сохранить интерфейс</button>
    </fieldset>

    <fieldset disabled={busy || user.role !== "admin"} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="settings-panel-title">Версия YOLO</div>
      <p className="text-sm">Базовая: <strong>{catalog?.active_base ?? "…"}</strong> · Кастомная: {catalog?.custom_weights ?? "не активирована"}</p>
      <p className="text-xs text-slate-400">Выбор общий для всех камер. YOLOv8 и YOLO11: N — быстрее и легче, X — тяжелее. Специализированный детектор оружия и кастомные веса остаются отдельными. Обучение новых кандидатов использует выбранную базу.</p>
       <CustomSelect ariaLabel="Базовая модель YOLO" value={model} onChange={setModel} options={catalog?.models.map(m => ({ value: m.id, label: m.label, hint: m.installed ? "Установлена" : "Нужна загрузка" })) ?? []} disabled={!catalog} />
       <label className="custom-check-row"><input className="custom-checkbox" type="checkbox" checked={download} onChange={e => setDownload(e.target.checked)} /><span>Разрешить загрузку официальных весов, если их нет на сервере</span></label>
      <button className="bg-indigo-600 rounded-lg px-4 py-2" onClick={() => run(async () => { setCatalog(await api.selectModel(model, download)); setMessage("Модель проверена и применена"); })}>{busy ? "Выполняется…" : "Применить модель"}</button>
    </fieldset>

    {user.role === "admin" && <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <h3 className="text-lg font-semibold">Доступ сотрудников</h3>
       <p className="text-xs text-slate-400">Директор: просмотр камер, архива и аналитики. Охрана: просмотр, проверка файлов и обработка инцидентов. Администратор: камеры, модели, обучение и сотрудники. Отключение, смена роли или пароля отзывает все сессии сотрудника.</p>
      <form className="grid md:grid-cols-2 gap-3" onSubmit={e => { e.preventDefault(); run(async () => { await api.createEmployee(newUser); setEmployees(await api.getEmployees()); setNewUser({ username: "", display_name: "", password: "", role: "viewer" }); setMessage("Сотрудник создан. Передайте логин и пароль безопасным способом."); }); }}>
        <input required aria-label="Логин сотрудника" placeholder="Логин: латиница, 3–64 символа" pattern="[a-z0-9][a-z0-9_.\-]{2,63}" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} className={input} />
        <input required aria-label="Имя сотрудника" placeholder="Имя сотрудника" value={newUser.display_name} onChange={e => setNewUser({ ...newUser, display_name: e.target.value })} className={input} />
        <input required type="password" minLength={12} maxLength={256} autoComplete="new-password" aria-label="Пароль сотрудника" placeholder="Пароль: минимум 12 символов" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} className={input} />
         <CustomSelect ariaLabel="Роль нового сотрудника" value={newUser.role} onChange={value => setNewUser({ ...newUser, role: String(value) })} options={Object.entries(roleName).map(([value, label]) => ({ value, label }))} />
         <button disabled={busy} className="accent-button rounded-lg px-4 py-2">Создать сотрудника</button>
      </form>
      <div className="space-y-3">{employees.map(employee => <div key={employee.id} className="border-t border-slate-700 pt-3 flex flex-wrap items-center gap-3">
        <span className="flex-1">{employee.display_name} · {employee.username} {!employee.is_active && "(отключён)"}</span>
         <CustomSelect className="employee-role-select" disabled={busy || employee.id === user.id} ariaLabel={`Роль ${employee.username}`} value={employee.role} onChange={role => { run(async () => { await api.updateEmployee(employee.id, { role: String(role) }); setEmployees(await api.getEmployees()); }); }} options={Object.entries(roleName).map(([value, label]) => ({ value, label }))} />
        <button disabled={busy || employee.id === user.id} onClick={() => run(async () => { await api.updateEmployee(employee.id, { is_active: !employee.is_active }); setEmployees(await api.getEmployees()); })} className="border border-slate-600 rounded-lg p-2">{employee.is_active ? "Отключить" : "Включить"}</button>
        <button onClick={() => { setResetId(employee.id); setNewPassword(""); }} className="border border-slate-600 rounded-lg p-2">Новый пароль</button>
      </div>)}</div>
      {resetId !== null && <form className="flex gap-3" onSubmit={e => { e.preventDefault(); run(async () => { await api.updateEmployee(resetId, { password: newPassword }); setResetId(null); setNewPassword(""); setMessage("Пароль изменён, прежние сессии отозваны"); }); }}>
        <input required type="password" minLength={12} maxLength={256} autoComplete="new-password" aria-label="Новый пароль" placeholder="Новый пароль (12+ символов)" value={newPassword} onChange={e => setNewPassword(e.target.value)} className={input} />
        <button disabled={busy} className="bg-indigo-600 rounded-lg p-2">Сохранить</button><button type="button" onClick={() => setResetId(null)}>Отмена</button>
      </form>}
    </section>}

    {user.role === "admin" && <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-lg font-semibold">Журнал действий</h3><p className="text-xs text-slate-400">Последние изменения, подтверждения и операции администраторов.</p></div>
        <button className="border border-slate-700 rounded-lg px-3 py-2 text-sm" onClick={() => run(async () => setAudit(await api.getAudit(100)))}>Обновить</button>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-slate-400 border-b border-slate-700"><th className="p-2">Время</th><th className="p-2">Пользователь</th><th className="p-2">Метод</th><th className="p-2">Путь</th><th className="p-2">Результат</th><th className="p-2">IP</th></tr></thead><tbody>
        {audit.map(entry => <tr key={entry.id} className="border-b border-slate-800"><td className="p-2 whitespace-nowrap">{new Date(entry.created_at).toLocaleString()}</td><td className="p-2">{entry.username}</td><td className="p-2">{entry.method}</td><td className="p-2 font-mono">{entry.path}</td><td className={`p-2 ${entry.status_code >= 400 ? "text-red-300" : "text-emerald-300"}`}>{entry.status_code}</td><td className="p-2">{entry.ip_address ?? "—"}</td></tr>)}
        {audit.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-500">Записей пока нет</td></tr>}
      </tbody></table></div>
    </section>}

    {user.role === "admin" && <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">Диагностика системы</h3><p className="text-xs text-slate-400">Состояние камер, диска, модели и обучения.</p></div><button className="border border-slate-700 rounded-lg px-3 py-2 text-sm" onClick={() => run(async () => setDiagnostics(await api.getDiagnostics()))}>Обновить</button></div>
      {diagnostics && <><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm"><div className="rounded-xl bg-slate-950 p-3">API: <strong className="text-emerald-300">{diagnostics.api}</strong></div><div className="rounded-xl bg-slate-950 p-3">БД: <strong className="text-emerald-300">{diagnostics.database}</strong></div><div className="rounded-xl bg-slate-950 p-3">Свободно: <strong>{diagnostics.disk.free_percent}%</strong></div><div className="rounded-xl bg-slate-950 p-3">Обучение: <strong>{diagnostics.training.running_jobs ? "идёт" : "свободно"}</strong></div></div><p className="text-xs text-slate-400">Базовая модель: {diagnostics.model.base} · Активная: {diagnostics.model.active} · Файл: {diagnostics.model.path_exists ? "найден" : "не найден"}</p><div className="space-y-2">{diagnostics.cameras.map(camera => <div key={camera.id} className="flex flex-wrap gap-3 items-center border-t border-slate-800 pt-2 text-sm"><span className={camera.online ? "text-emerald-300" : "text-red-300"}>●</span><span className="flex-1">{camera.name}</span><span>{camera.online ? `${camera.fps.toFixed(1)} FPS · ${camera.latency_ms.toFixed(0)} мс` : camera.last_error ?? "Нет связи"}</span></div>)}</div></>}
    </section>}
  </div>;
}
