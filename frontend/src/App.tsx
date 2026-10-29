import React, { useEffect, useState } from "react";
import { api, DashboardStats, defaultPreferences, Preferences, User } from "./api/client";
import { AppTab, Navbar } from "./components/Navbar";
import { DashboardPage } from "./pages/DashboardPage";
import { LabPage } from "./pages/LabPage";
import { TrainingPage } from "./pages/TrainingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StatsOverview } from "./components/StatsOverview";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";

export default function App() {
  const displayMode = window.location.pathname === "/display";
  const [activeTab, setActiveTab] = useState<AppTab>("dashboard");
  const [globalStats, setGlobalStats] = useState<DashboardStats | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [appearancePreview, setAppearancePreview] = useState<Preferences | null>(null);
  const appearance = appearancePreview ?? preferences;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [adminLogin, setAdminLogin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginFieldError, setLoginFieldError] = useState<string | null>(null);
  const accentRgb = (() => {
    const legacy: Record<string, string> = { indigo: "#6366f1", blue: "#3b82f6", emerald: "#10b981", violet: "#8b5cf6", rose: "#f43f5e" };
    const hex = legacy[appearance.accent] ?? appearance.accent;
    const match = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!match) return "99 102 241";
    const value = match[1];
    return `${parseInt(value.slice(0, 2), 16)} ${parseInt(value.slice(2, 4), 16)} ${parseInt(value.slice(4, 6), 16)}`;
  })();

  async function loadSession() {
    const session = await api.session();
    const prefs = await api.getPreferences();
    setUser(session.user); setPreferences(prefs);
    const tab = prefs.default_tab;
    setActiveTab((tab === "training" && session.user.role !== "admin") || (tab === "lab" && session.user.role === "viewer") ? "dashboard" : tab);
    setAuthenticated(true);
  }

  useEffect(() => {
    loadSession().catch(() => {}).finally(() => setChecking(false));
    const expired = () => { setAuthenticated(false); setGlobalStats(null); setUser(null); };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);

  useEffect(() => {
    if (authenticated) api.getStats().then(setGlobalStats).catch(() => {});
  }, [activeTab, authenticated]);

  if (checking) return <div className="min-h-screen bg-slate-950 text-white p-8">Подключение…</div>;
  if (!authenticated) return (
    <main className="login-shell">
      <div className="login-glow login-glow-one" /><div className="login-glow login-glow-two" />
      <form className="login-card" noValidate onSubmit={async (e) => {
        e.preventDefault(); setError(null); setLoginFieldError(null);
        const missing = adminLogin ? !key.trim() : !username.trim() ? "Введите логин" : !password ? "Введите пароль" : null;
        if (missing) { setLoginFieldError(missing === true ? "Заполните это поле" : missing); return; }
        setLoginBusy(true);
        try { if (adminLogin) await api.login(key); else await api.loginEmployee(username, password); setKey(""); setPassword(""); await loadSession(); }
        catch (err) { setError(err instanceof Error ? err.message : "Ошибка входа"); }
        finally { setLoginBusy(false); }
      }}>
        <div className="login-brand"><div className="login-brand-icon"><ShieldCheck /></div><div><p className="login-kicker">School Security</p><h1>Школьный видеомониторинг</h1></div></div>
        <p className="login-subtitle">Безопасность школы под контролем</p>
        <div className="login-mode-switch" role="tablist" aria-label="Способ входа">
          <button type="button" className={!adminLogin ? "active" : ""} onClick={() => { setAdminLogin(false); setError(null); }}><UserRound /> Сотрудник</button>
          <button type="button" className={adminLogin ? "active" : ""} onClick={() => { setAdminLogin(true); setError(null); }}><KeyRound /> API-ключ</button>
        </div>
        {adminLogin ? <label className={`login-field ${loginFieldError ? "has-error" : ""}`}><span>Ключ администратора</span><div className="login-input-wrap"><KeyRound /><input type="password" autoComplete="current-password" placeholder="Введите ключ доступа" value={key} onChange={(e) => { setKey(e.target.value); setLoginFieldError(null); }} /></div>{loginFieldError && <small className="login-field-error">{loginFieldError}</small>}</label> : <>
          <label className={`login-field ${loginFieldError && !username.trim() ? "has-error" : ""}`}><span>Логин</span><div className="login-input-wrap"><UserRound /><input autoComplete="username" placeholder="Введите логин" value={username} onChange={e => { setUsername(e.target.value); setLoginFieldError(null); }} /></div>{loginFieldError && !username.trim() && <small className="login-field-error">{loginFieldError}</small>}</label>
          <label className={`login-field ${loginFieldError && username.trim() && !password ? "has-error" : ""}`}><span>Пароль</span><div className="login-input-wrap"><LockKeyhole /><input type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Введите пароль" value={password} onChange={e => { setPassword(e.target.value); setLoginFieldError(null); }} /><button type="button" className="login-password-toggle" aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button></div>{loginFieldError && username.trim() && !password && <small className="login-field-error">{loginFieldError}</small>}</label>
        </>}
        {error && <p role="alert" className="login-error">{error}</p>}
        <button className="login-submit" type="submit" disabled={loginBusy}>{loginBusy ? <><span className="login-spinner" />Проверяем данные…</> : "Войти в систему"}</button>
        <p className="login-footer">Доступ только для авторизованных сотрудников</p>
        <ConnectionStatus />
      </form>
    </main>
  );

  return (
    <div className={`app-shell min-h-screen text-slate-100 flex flex-col theme-${appearance.theme} rounding-${appearance.rounding} ${appearance.liquid_glass ? "liquid-glass" : ""} ${appearance.compact ? "compact-ui" : ""} ${appearance.animations ? "" : "no-animations"}`} style={{ "--accent": accentRgb, "--glass-opacity": 1 - appearance.transparency / 100 } as React.CSSProperties}>
      {!displayMode && <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        unacknowledgedCount={globalStats?.unacknowledged_violations ?? 0}
        activeWeights={globalStats?.model.active_weights ?? "Ожидание модели"}
        role={user?.role ?? "viewer"}
        displayName={user?.display_name ?? "Сотрудник"}
        onLogout={async () => { await api.logout(); setAuthenticated(false); setGlobalStats(null); setUser(null); }}
      />}

      <main className={`flex-1 w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 ${displayMode ? "max-w-[1800px]" : "max-w-7xl"}`}>
        {!displayMode && <div className="flex justify-between items-center gap-4 mb-5 text-xs text-slate-400">
          <div className="space-y-2"><ConnectionStatus /><p>Автоматические срабатывания требуют проверки человеком. Отсутствие тревоги не гарантирует безопасность.</p></div>
        </div>}
        {(displayMode || activeTab === "dashboard") && <div className="space-y-6"><div className="page-heading"><p className="eyebrow">Центр управления безопасностью</p><h2>Обзор ситуации</h2><p>Ключевые показатели состояния камер и событий за текущий период.</p></div><StatsOverview stats={globalStats} /><div className="quick-note"><span>Нужна детализация?</span><button onClick={() => setActiveTab("analytics")}>Открыть полную аналитику →</button></div></div>}
        {activeTab === "monitoring" && <DashboardPage onGlobalStatsUpdate={setGlobalStats} preferences={preferences} role={user?.role ?? "viewer"} displayMode={displayMode} />}
        {activeTab === "analytics" && <div className="space-y-6"><div className="page-heading"><p className="eyebrow">Отчёты и динамика</p><h2>Подробная аналитика</h2><p>Распределение событий, временная динамика и качество работы детектора.</p></div><StatsOverview stats={globalStats} detailed /></div>}
        {activeTab === "lab" && user?.role !== "viewer" && <LabPage />}
        {activeTab === "training" && user?.role === "admin" && <TrainingPage />}
        {activeTab === "settings" && user && <SettingsPage user={user} preferences={preferences} onPreferences={setPreferences} onPreview={setAppearancePreview} />}
      </main>
    </div>
  );
}
