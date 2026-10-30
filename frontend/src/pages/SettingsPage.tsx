import React, { useEffect, useState } from "react";
import { api, AuditEntry, Diagnostics, Employee, ModelCatalog, Preferences, Role, User } from "../api/client";
import { CustomSelect } from "../components/CustomSelect";
import { ColorWheel } from "../components/ColorWheel";
import { CustomMultiSelect } from "../components/CustomMultiSelect";
import { QRCodeSVG } from "qrcode.react";
import { ServerUpdates } from "../components/ServerUpdates";
import { Bell, BrainCircuit, Monitor, Server, ShieldCheck, Users } from "lucide-react";

interface Props { user: User; preferences: Preferences; onPreferences: (value: Preferences) => void; onPreview: (value: Preferences | null) => void }
const input = "custom-input";
const settingsSections = [
  { id: "appearance", label: "Интерфейс", description: "Оформление и рабочее пространство", icon: Monitor, admin: false },
  { id: "security", label: "Безопасность", description: "Пароль, устройства и двухфакторная защита", icon: ShieldCheck, admin: false },
  { id: "people", label: "Сотрудники", description: "Учётные записи, роли и разрешения", icon: Users, admin: true },
  { id: "models", label: "Детекция", description: "Модели и пороги распознавания", icon: BrainCircuit, admin: false },
  { id: "notifications", label: "Уведомления", description: "Доставка тревог и интеграции", icon: Bell, admin: true },
  { id: "system", label: "Сервер", description: "Обновления, диагностика и журнал действий", icon: Server, admin: true },
];
const roleName: Record<string, string> = { admin: "Администратор", operator: "Охрана", viewer: "Директор" };
const permissionOptions = [
  { key: "view_monitoring", label: "Просмотр камер и мониторинга" },
  { key: "review_incidents", label: "Обработка инцидентов" },
  { key: "analyze_files", label: "Проверка фото и видео" },
  { key: "manage_cameras", label: "Добавление и настройка камер" },
  { key: "manage_employees", label: "Сотрудники и доступ" },
  { key: "manage_models", label: "Выбор моделей YOLO" },
  { key: "train_model", label: "Дообучение модели" },
  { key: "export_archive", label: "Экспорт архива и отчётов" },
];

export function SettingsPage({ user, preferences, onPreferences, onPreview }: Props) {
  const [section, setSection] = useState("appearance");
  const [draft, setDraft] = useState(preferences);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [newRole, setNewRole] = useState({ name: "", description: "", permissions: [] as string[] });
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
  const [sessions, setSessions] = useState<Array<{ expires_at: string; current: boolean }>>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPasswordValue, setNewPasswordValue] = useState("");
  const [twoFactor, setTwoFactor] = useState<{ enabled: boolean; available: boolean }>({ enabled: false, available: false });
  const [twoFactorSecret, setTwoFactorSecret] = useState<string | null>(null);
  const [twoFactorUri, setTwoFactorUri] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [thresholds, setThresholds] = useState({ confidence: 0.42, weapon_confidence: 0.5, custom_confidence: 0.52 });
  const [recording, setRecording] = useState<{ before_seconds: number; after_seconds: number } | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingMessage, setRecordingMessage] = useState<string | null>(null);

  async function loadRecording() {
    setRecordingBusy(true); setRecordingError(null);
    try { setRecording(await api.getRecordingSettings()); }
    catch (e) { setRecordingError(e instanceof Error ? e.message : "Не удалось загрузить настройки записи"); }
    finally { setRecordingBusy(false); }
  }

  useEffect(() => { onPreview(draft); }, [draft, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  useEffect(() => {
    api.modelCatalog().then(c => { setCatalog(c); setModel(c.models.find(m => m.filename === c.active_base)?.id ?? "yolov8n"); }).catch(e => setError(e.message));
    if (user.role === "admin") api.getEmployees().then(setEmployees).catch(e => setError(e.message));
    if (user.role === "admin") {
      setRolesLoading(true);
      api.getRoles().then(setRoles).catch(e => setError(`Не удалось загрузить роли: ${e.message}`)).finally(() => setRolesLoading(false));
    }
    if (user.role === "admin") api.getAudit(100).then(setAudit).catch(e => setError(e.message));
    if (user.role === "admin") api.getDiagnostics().then(setDiagnostics).catch(e => setError(e.message));
    api.getSessions().then(setSessions).catch(e => setError(e.message));
    api.twoFactorStatus().then(setTwoFactor).catch(e => setError(e.message));
    if (user.role === "admin") api.getThresholds().then(setThresholds).catch(e => setError(e.message));
    if (user.role === "admin") void loadRecording();
  }, [user.role]);

  async function run(action: () => Promise<void>) {
    setError(null); setMessage(null); setBusy(true);
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Ошибка сохранения"); }
    finally { setBusy(false); }
  }

  const baseRoleOptions = roles.length ? roles.map(role => ({ value: role.key, label: role.name, hint: role.description })) : [
    { value: "admin", label: "Администратор", hint: "Полный доступ к системе" },
    { value: "operator", label: "Охрана", hint: "Мониторинг и обработка тревог" },
    { value: "viewer", label: "Директор", hint: "Просмотр камер, архива и аналитики" },
  ];
  const roleOptions = newUser.role !== "" && !baseRoleOptions.some(role => role.value === newUser.role)
    ? [...baseRoleOptions, { value: newUser.role, label: "Текущая роль", hint: "Роль не найдена в загруженном списке" }]
    : baseRoleOptions;

  return <div className="settings-page space-y-6">
    <div className="page-heading"><h2>Всё на своих местах</h2><p>Ваше рабочее пространство, доступ и состояние системы.</p></div>
    <div className="settings-layout">
    <nav className="settings-navigation" aria-label="Разделы настроек">{settingsSections.filter(item => !item.admin || user.role === "admin").map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}><Icon aria-hidden="true" size={18} />{label}</button>)}<div className="settings-identity"><strong>{user.display_name}</strong><span>{user.role_name ?? roleName[user.role] ?? "Пользовательская роль"}</span></div></nav>
    <div className="settings-content space-y-5">
    <div className="settings-section-heading"><h3>{settingsSections.find(item => item.id === section)?.label}</h3><p>{settingsSections.find(item => item.id === section)?.description}</p></div>
    {user.role === "admin" && section === "system" && <ServerUpdates />}
    {error && <p role="alert" className="bg-red-950 text-red-200 p-3 rounded-xl">{error}</p>}
    {message && <p role="status" className="bg-emerald-950 text-emerald-200 p-3 rounded-xl">{message}</p>}
    {user.role === "admin" && section === "models" && <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="settings-panel-title">Запись нарушения</div>
      <p className="text-xs text-slate-400">Общая длительность видеофрагментов для всех камер. Применяется к новым срабатываниям; старые записи и уже начатые фрагменты не меняются.</p>
      {recordingError && <div role="alert"><p>{recordingError}</p><button type="button" disabled={recordingBusy} onClick={() => void loadRecording()}>Повторить загрузку настроек записи</button></div>}
      {!recording && !recordingError && <p role="status">Загрузка настроек записи…</p>}
      {recording && <form className="space-y-4" onSubmit={async event => {
        event.preventDefault(); if (recordingBusy) return;
        setRecordingBusy(true); setRecordingError(null); setRecordingMessage(null);
        try { setRecording(await api.setRecordingSettings(recording)); setRecordingMessage("Длительность записи сохранена и применена к камерам"); }
        catch (e) { setRecordingError(e instanceof Error ? e.message : "Не удалось сохранить настройки записи"); }
        finally { setRecordingBusy(false); }
      }}>
        <fieldset disabled={recordingBusy} className="grid md:grid-cols-2 gap-3">
          {([ ["before_seconds", "До нарушения, секунд"], ["after_seconds", "После нарушения, секунд"] ] as const).map(([key, label]) => <label className="block text-sm" key={key}>{label}<input className={input} required type="number" min={0} max={30} step={1} value={Number.isFinite(recording[key]) ? recording[key] : ""} onChange={event => { setRecording({ ...recording, [key]: event.target.value === "" ? NaN : Number(event.target.value) }); setRecordingMessage(null); }} /></label>)}
        </fieldset>
        <p className="text-xs text-slate-400">От 0 до 30 секунд с каждой стороны. Перед записью нужен прогрев буфера; при запуске, потере связи или достижении лимита памяти фрагмент может быть короче. Видео появляется в архиве после записи и кодирования. Одновременно сохраняется один фрагмент на камеру.</p>
        <button disabled={recordingBusy || !Number.isInteger(recording.before_seconds) || !Number.isInteger(recording.after_seconds)} className="accent-button rounded-lg px-4 py-2">{recordingBusy ? "Сохранение…" : "Сохранить длительность записи"}</button>
      </form>}
      {recordingMessage && <p role="status">{recordingMessage}</p>}
    </section>}
    {user.role === "admin" && <section hidden={section !== "notifications"} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="settings-panel-title">Уведомления о тревогах</div>
      <p className="text-xs text-slate-400">Telegram и webhook настраиваются администратором на сервере в файле `.env`. При срабатывании система отправляет тип угрозы, камеру и уверенность детектора.</p>
      <div className="notification-hints"><span>Telegram: <b>TELEGRAM_BOT_TOKEN</b> + <b>TELEGRAM_CHAT_ID</b></span><span>Webhook: <b>NOTIFICATION_WEBHOOK_URL</b></span><span>Ограничение повторов: <b>NOTIFICATION_COOLDOWN_SEC</b></span></div>
    </section>}
    <section hidden={section !== "security"} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="settings-panel-title">Профиль и безопасность</div>
      <p className="text-xs text-slate-400">{user.display_name} · {user.role_name ?? roleName[user.role] ?? "Пользовательская роль"}. Смена пароля завершит все активные сессии.</p>
      <form className="profile-password-form" onSubmit={event => { event.preventDefault(); run(async () => { await api.changePassword(currentPassword, newPasswordValue); setCurrentPassword(""); setNewPasswordValue(""); setMessage("Пароль изменён. Войдите снова с новым паролем."); }); }}>
        <input className={input} type="password" minLength={1} autoComplete="current-password" placeholder="Текущий пароль" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required />
        <input className={input} type="password" minLength={12} autoComplete="new-password" placeholder="Новый пароль (минимум 12 символов)" value={newPasswordValue} onChange={event => setNewPasswordValue(event.target.value)} required />
        <button className="accent-button rounded-lg px-4 py-2" disabled={busy}>Изменить пароль</button>
      </form>
      <div className="session-list"><div className="flex items-center justify-between gap-3"><strong className="text-sm">Активные сессии: {sessions.length}</strong><button className="border border-slate-700 rounded-lg px-3 py-2 text-xs" onClick={() => run(async () => { await api.revokeAllSessions(); setSessions([]); setMessage("Все сессии завершены"); })}>Выйти со всех устройств</button></div>{sessions.map((session, index) => <div className="session-row" key={`${session.expires_at}-${index}`}><span>{session.current ? "Текущая сессия" : "Другое устройство"}</span><small>до {new Date(session.expires_at).toLocaleString("ru-RU")}</small></div>)}</div>
    </section>
    <section hidden={section !== "security"} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="settings-panel-title">Двухфакторная защита</div>
      <p className="text-xs text-slate-400">Используйте Google Authenticator, Authy или другое приложение TOTP. Код проверяется на сервере с допуском одного временного шага.</p>
      {twoFactor.available && <label className="block text-sm">Текущий пароль для изменения 2FA<input className={input} type="password" autoComplete="current-password" value={twoFactorPassword} onChange={event => setTwoFactorPassword(event.target.value)} /></label>}
      {twoFactor.enabled && <label className="block text-sm">Новый код из приложения<input className={`${input} two-factor-code`} autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={twoFactorCode} onChange={event => setTwoFactorCode(event.target.value.replace(/\D/g, ""))} /><span className="text-xs text-slate-400">Если этот код уже использован при входе, дождитесь следующего.</span></label>}
      <div className="flex flex-wrap items-center gap-3"><span className={twoFactor.enabled ? "text-emerald-300" : "text-amber-300"}>{twoFactor.enabled ? "2FA включена" : "2FA выключена"}</span>{!twoFactor.enabled ? <button disabled={busy || !twoFactor.available || !twoFactorPassword} className="accent-button rounded-lg px-4 py-2" onClick={() => run(async () => { const value = await api.twoFactorSetup(twoFactorPassword); setTwoFactorPassword(""); setTwoFactorSecret(value.secret); setTwoFactorUri(value.otpauth_url); setTwoFactorCode(""); setMessage("Отсканируйте QR-код и подтвердите кодом в течение 10 минут."); })}>Подключить 2FA</button> : <button disabled={busy || !twoFactorPassword || twoFactorCode.length !== 6} className="border border-red-500/40 text-red-300 rounded-lg px-4 py-2" onClick={() => run(async () => { const value = await api.twoFactorDisable(twoFactorPassword, twoFactorCode); setTwoFactorPassword(""); setTwoFactorCode(""); setTwoFactorSecret(null); setTwoFactorUri(null); setTwoFactor(current => ({ ...current, ...value })); setMessage("2FA отключена. Другие сессии завершены."); })}>Отключить 2FA</button>}</div>
      {twoFactorUri && !twoFactor.enabled && <div className="flex flex-wrap items-center gap-5"><div className="bg-white p-4 rounded-xl"><QRCodeSVG value={twoFactorUri} size={200} level="M" marginSize={4} title="QR-код подключения двухфакторной защиты" /></div><div className="max-w-sm space-y-2 text-sm text-slate-400"><p>Откройте приложение-аутентификатор → добавьте аккаунт → отсканируйте QR-код.</p><p>Введите код из приложения ниже, чтобы завершить подключение.</p><p className="text-xs">Не передавайте QR-код и секретный ключ другим людям. Код генерируется локально, без сторонних сервисов.</p></div></div>}
      {twoFactorSecret && !twoFactor.enabled && <div className="two-factor-panel"><div><span className="two-factor-label">Ключ для ручного подключения</span><code className="two-factor-secret">{twoFactorSecret.match(/.{1,4}/g)?.join(" ")}</code></div><div className="two-factor-confirm"><label className="two-factor-code-label"><span className="two-factor-label">Код из приложения</span><input className={`${input} two-factor-code`} aria-label="Код подтверждения двухфакторной защиты" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={twoFactorCode} onChange={e => setTwoFactorCode(e.target.value.replace(/\D/g, ""))} /></label><button disabled={busy || twoFactorCode.length !== 6} className="accent-button rounded-lg px-4 py-2" onClick={() => run(async () => { const value = await api.twoFactorEnable(twoFactorCode); setTwoFactor(current => ({ ...current, ...value })); setTwoFactorSecret(null); setTwoFactorUri(null); setTwoFactorCode(""); setMessage("2FA включена"); })}>Подтвердить</button></div></div>}
    </section>
    {user.role === "admin" && section === "models" && <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"><div className="settings-panel-title">Пороги детекции</div><p className="text-xs text-slate-400">Изменения применяются к новым кадрам и сохраняются в базе.</p><div className="grid md:grid-cols-3 gap-3">{([ ["confidence", "Общий"], ["weapon_confidence", "Оружие"], ["custom_confidence", "Кастомная модель"] ] as const).map(([key, label]) => <label className="text-sm" key={key}>{label}: {Math.round(thresholds[key] * 100)}%<input className="modern-range" type="range" min="0.05" max="0.99" step="0.01" value={thresholds[key]} onChange={e => setThresholds({ ...thresholds, [key]: Number(e.target.value) })} /></label>)}</div><button className="accent-button rounded-lg px-4 py-2" onClick={() => run(async () => { await api.setThresholds(thresholds); setMessage("Пороги детекции сохранены"); })}>Сохранить пороги</button></section>}
    <fieldset hidden={section !== "appearance"} disabled={busy} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="settings-panel-title">Мой интерфейс</div>
      <p className="text-xs text-slate-400">Сохраняется на сервере отдельно для каждой учётной записи. Скрытие блока не меняет права доступа.</p>
       <label className="block text-sm">Максимум камер в строке видеостены
         <CustomSelect value={draft.columns} onChange={value => setDraft({ ...draft, columns: value as Preferences["columns"] })} options={[3,4,5,6,7,8].map(n => ({ value: n as Preferences["columns"], label: `${n === 3 ? 4 : n} камер в строке` }))} />
      </label>
      <label className="block text-sm">Стартовая страница
        <CustomSelect value={draft.default_tab} onChange={value => setDraft({ ...draft, default_tab: value as Preferences["default_tab"] })} options={[{ value: "dashboard", label: "Обзор" }, { value: "monitoring", label: "Мониторинг" }, { value: "analytics", label: "Аналитика" }, ...(user.role !== "viewer" ? [{ value: "lab", label: "Лаборатория" }] : []), ...(user.role === "admin" ? [{ value: "training", label: "Обучение" }] : []), { value: "settings", label: "Настройки" }]} />
      </label>
      <div className="settings-subsection"><h3>Внешний вид</h3><p className="text-xs text-slate-400">Настройки сохраняются только для текущей учётной записи.</p></div>
      <label className="custom-check-row"><input className="custom-checkbox" type="checkbox" checked={draft.liquid_glass} onChange={e => setDraft({ ...draft, liquid_glass: e.target.checked })} /><span>Liquid Glass — стеклянные панели</span></label>
      <label className="block text-sm">Прозрачность панелей <strong>{draft.transparency}%</strong><input className="modern-range" type="range" min={0} max={70} disabled={!draft.liquid_glass} value={draft.transparency} style={{ "--range-progress": `${draft.transparency / 70 * 100}%` } as React.CSSProperties} onChange={e => setDraft({ ...draft, transparency: Number(e.target.value) })} /><span className="text-xs text-slate-400">0% — непрозрачные панели; 70% — максимальная прозрачность. Оформление меняется сразу; нажмите «Сохранить интерфейс», чтобы сохранить его.</span></label>
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

    <fieldset hidden={section !== "models"} disabled={busy || user.role !== "admin"} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="settings-panel-title">Версия YOLO</div>
      <p className="text-sm">Базовая: <strong>{catalog?.active_base ?? "…"}</strong> · Кастомная: {catalog?.custom_weights ?? "не активирована"}</p>
      <p className="text-xs text-slate-400">Выбор общий для всех камер. YOLOv8 и YOLO11: N — быстрее и легче, X — тяжелее. Специализированный детектор оружия и кастомные веса остаются отдельными. Обучение новых кандидатов использует выбранную базу.</p>
       <CustomSelect ariaLabel="Базовая модель YOLO" value={model} onChange={setModel} options={catalog?.models.map(m => ({ value: m.id, label: m.label, hint: m.installed ? "Установлена" : "Нужна загрузка" })) ?? []} disabled={!catalog} />
       <label className="custom-check-row"><input className="custom-checkbox" type="checkbox" checked={download} onChange={e => setDownload(e.target.checked)} /><span>Разрешить загрузку официальных весов, если их нет на сервере</span></label>
      <button className="bg-indigo-600 rounded-lg px-4 py-2" onClick={() => run(async () => { setCatalog(await api.selectModel(model, download)); setMessage("Модель проверена и применена"); })}>{busy ? "Выполняется…" : "Применить модель"}</button>
    </fieldset>

    {user.role === "admin" && <section hidden={section !== "people"} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
       <h3 className="text-lg font-semibold">Доступ сотрудников</h3>
       <p className="text-xs text-slate-400">Директор: просмотр камер, архива и аналитики. Охрана: просмотр, проверка файлов и обработка инцидентов. Администратор: камеры, модели, обучение и сотрудники. Отключение, смена роли или пароля отзывает все сессии сотрудника.</p>
       {error?.startsWith("Не удалось загрузить роли") && <div className="settings-inline-warning"><span>Список ролей временно недоступен. Используются базовые роли.</span><button type="button" onClick={() => { setError(null); setRolesLoading(true); api.getRoles().then(setRoles).catch(e => setError(`Не удалось загрузить роли: ${e.message}`)).finally(() => setRolesLoading(false)); }}>Повторить</button></div>}
       <form className="grid md:grid-cols-2 gap-3" onSubmit={e => { e.preventDefault(); run(async () => { await api.createEmployee(newUser); setEmployees(await api.getEmployees()); setNewUser({ username: "", display_name: "", password: "", role: roles[0]?.key ?? "viewer" }); setMessage("Сотрудник создан. Передайте логин и пароль безопасным способом."); }); }}>
        <input required aria-label="Логин сотрудника" placeholder="Логин: латиница, 3–64 символа" pattern="[a-z0-9][a-z0-9_.\-]{2,63}" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} className={input} />
        <input required aria-label="Имя сотрудника" placeholder="Имя сотрудника" value={newUser.display_name} onChange={e => setNewUser({ ...newUser, display_name: e.target.value })} className={input} />
        <input required type="password" minLength={12} maxLength={256} autoComplete="new-password" aria-label="Пароль сотрудника" placeholder="Пароль: минимум 12 символов" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} className={input} />
         <CustomSelect ariaLabel="Роль нового сотрудника" value={newUser.role} onChange={value => setNewUser({ ...newUser, role: String(value) })} options={roleOptions} disabled={rolesLoading} />
         <button disabled={busy} className="accent-button rounded-lg px-4 py-2">Создать сотрудника</button>
      </form>
      <div className="space-y-3">{employees.map(employee => <div key={employee.id} className="border-t border-slate-700 pt-3 flex flex-wrap items-center gap-3">
        <span className="flex-1">{employee.display_name} · {employee.username} {!employee.is_active && "(отключён)"}</span>
           <CustomSelect className="employee-role-select" disabled={busy || rolesLoading || employee.id === user.id} ariaLabel={`Роль ${employee.username}`} value={employee.role} onChange={role => { run(async () => { await api.updateEmployee(employee.id, { role: String(role) }); setEmployees(await api.getEmployees()); }); }} options={roleOptions} />
        <button disabled={busy || employee.id === user.id} onClick={() => run(async () => { await api.updateEmployee(employee.id, { is_active: !employee.is_active }); setEmployees(await api.getEmployees()); })} className="border border-slate-600 rounded-lg p-2">{employee.is_active ? "Отключить" : "Включить"}</button>
        <button onClick={() => { setResetId(employee.id); setNewPassword(""); }} className="border border-slate-600 rounded-lg p-2">Новый пароль</button>
      </div>)}</div>
      {resetId !== null && <form className="flex gap-3" onSubmit={e => { e.preventDefault(); run(async () => { await api.updateEmployee(resetId, { password: newPassword }); setResetId(null); setNewPassword(""); setMessage("Пароль изменён, прежние сессии отозваны"); }); }}>
        <input required type="password" minLength={12} maxLength={256} autoComplete="new-password" aria-label="Новый пароль" placeholder="Новый пароль (12+ символов)" value={newPassword} onChange={e => setNewPassword(e.target.value)} className={input} />
        <button disabled={busy} className="bg-indigo-600 rounded-lg p-2">Сохранить</button><button type="button" onClick={() => setResetId(null)}>Отмена</button>
      </form>}
      <div className="role-builder">
        <div><h4>Конструктор ролей</h4><p>Создайте название должности, опишите её функцию и укажите разрешения.</p></div>
        <form className="role-builder-form" onSubmit={e => { e.preventDefault(); run(async () => { await api.createRole(newRole); setRoles(await api.getRoles()); setNewRole({ name: "", description: "", permissions: [] }); setMessage("Роль создана"); }); }}>
          <input required maxLength={80} className={input} placeholder="Название роли, например Архивариус" value={newRole.name} onChange={e => setNewRole({ ...newRole, name: e.target.value })} />
          <input maxLength={240} className={input} placeholder="Функция роли" value={newRole.description} onChange={e => setNewRole({ ...newRole, description: e.target.value })} />
          <CustomMultiSelect disabled={busy} value={newRole.permissions} onChange={permissions => setNewRole({ ...newRole, permissions })} options={permissionOptions.map(permission => ({ value: permission.key, label: permission.label }))} />
          <button disabled={busy} className="accent-button rounded-lg px-4 py-2">Создать роль</button>
        </form>
        <div className="role-list">{roles.filter(role => !role.is_system).map(role => <div className="role-card" key={role.key}><div><strong>{role.name}</strong><span>{role.description || "Без описания"}</span></div><button disabled={busy} onClick={() => run(async () => { await api.deleteRole(role.key); setRoles(await api.getRoles()); setMessage("Роль удалена"); })}>Удалить</button></div>)}</div>
      </div>
    </section>}

    {user.role === "admin" && <section hidden={section !== "system"} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-lg font-semibold">Журнал действий</h3><p className="text-xs text-slate-400">Последние изменения, подтверждения и операции администраторов.</p></div>
        <button className="border border-slate-700 rounded-lg px-3 py-2 text-sm" onClick={() => run(async () => setAudit(await api.getAudit(100)))}>Обновить</button>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-slate-400 border-b border-slate-700"><th className="p-2">Время</th><th className="p-2">Пользователь</th><th className="p-2">Метод</th><th className="p-2">Путь</th><th className="p-2">Результат</th><th className="p-2">IP</th></tr></thead><tbody>
        {audit.map(entry => <tr key={entry.id} className="border-b border-slate-800"><td className="p-2 whitespace-nowrap">{new Date(entry.created_at).toLocaleString()}</td><td className="p-2">{entry.username}</td><td className="p-2">{entry.method}</td><td className="p-2 font-mono">{entry.path}</td><td className={`p-2 ${entry.status_code >= 400 ? "text-red-300" : "text-emerald-300"}`}>{entry.status_code}</td><td className="p-2">{entry.ip_address ?? "—"}</td></tr>)}
        {audit.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-500">Записей пока нет</td></tr>}
      </tbody></table></div>
    </section>}

    {user.role === "admin" && <section hidden={section !== "system"} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">Диагностика системы</h3><p className="text-xs text-slate-400">Состояние камер, диска, модели и обучения.</p></div><button className="border border-slate-700 rounded-lg px-3 py-2 text-sm" onClick={() => run(async () => setDiagnostics(await api.getDiagnostics()))}>Обновить</button></div>
      {diagnostics && <><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm"><div className="rounded-xl bg-slate-950 p-3">API: <strong className="text-emerald-300">{diagnostics.api}</strong></div><div className="rounded-xl bg-slate-950 p-3">БД: <strong className="text-emerald-300">{diagnostics.database}</strong></div><div className="rounded-xl bg-slate-950 p-3">Свободно: <strong>{diagnostics.disk.free_percent}%</strong></div><div className="rounded-xl bg-slate-950 p-3">Обучение: <strong>{diagnostics.training.running_jobs ? "идёт" : "свободно"}</strong></div></div><p className="text-xs text-slate-400">Базовая модель: {diagnostics.model.base} · Активная: {diagnostics.model.active} · Файл: {diagnostics.model.path_exists ? "найден" : "не найден"}</p><div className="space-y-2">{diagnostics.cameras.map(camera => <div key={camera.id} className="flex flex-wrap gap-3 items-center border-t border-slate-800 pt-2 text-sm"><span className={camera.online ? "text-emerald-300" : "text-red-300"}>●</span><span className="flex-1">{camera.name}</span><span>{camera.online ? `${camera.fps.toFixed(1)} FPS · ${camera.latency_ms.toFixed(0)} мс` : camera.last_error ?? "Нет связи"}</span></div>)}</div></>}
    </section>}
    </div></div>
  </div>;
}
