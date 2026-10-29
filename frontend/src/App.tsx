import React, { useEffect, useState } from "react";
import { api, DashboardStats, defaultPreferences, Preferences, User } from "./api/client";
import { AppTab, Navbar } from "./components/Navbar";
import { DashboardPage } from "./pages/DashboardPage";
import { LabPage } from "./pages/LabPage";
import { TrainingPage } from "./pages/TrainingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StatsOverview } from "./components/StatsOverview";

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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [adminLogin, setAdminLogin] = useState(false);

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
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <form className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setError(null);
        try { if (adminLogin) await api.login(key); else await api.loginEmployee(username, password); setKey(""); setPassword(""); await loadSession(); }
        catch (err) { setError(err instanceof Error ? err.message : "Ошибка входа"); }
      }}>
        <h1 className="text-xl font-semibold">Школьный видеомониторинг</h1>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={adminLogin} onChange={e => { setAdminLogin(e.target.checked); setError(null); }} />Войти ключом администратора</label>
        {adminLogin ? <label className="block text-sm">Ключ доступа API_KEY из серверного .env
          <input type="password" autoComplete="current-password" value={key} onChange={(e) => setKey(e.target.value)} required className="block w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg p-3" />
        </label> : <>
          <label className="block text-sm">Логин<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required className="block w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg p-3" /></label>
          <label className="block text-sm">Пароль<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required className="block w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg p-3" /></label>
        </>}
        {error && <p role="alert" className="text-red-300 text-sm">{error}</p>}
        <button className="w-full rounded-lg bg-indigo-600 p-3" type="submit">Войти</button>
      </form>
    </main>
  );

  return (
    <div className={`app-shell min-h-screen text-slate-100 flex flex-col theme-${preferences.theme} accent-${preferences.accent} rounding-${preferences.rounding} ${preferences.compact ? "compact-ui" : ""} ${preferences.animations ? "" : "no-animations"}`}>
      {!displayMode && <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        unacknowledgedCount={globalStats?.unacknowledged_violations ?? 0}
        activeWeights={globalStats?.model.active_weights ?? "Ожидание модели"}
        role={user?.role ?? "viewer"}
      />}

      <main className={`flex-1 w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 ${displayMode ? "max-w-[1800px]" : "max-w-7xl"}`}>
        {!displayMode && <div className="flex justify-between items-center gap-4 mb-5 text-xs text-slate-400">
          <span>Автоматические срабатывания требуют проверки человеком. Отсутствие тревоги не гарантирует безопасность.</span>
          <button onClick={async () => { await api.logout(); setAuthenticated(false); setGlobalStats(null); setUser(null); }} className="border border-slate-700 rounded-lg px-3 py-2 shrink-0">{user?.display_name} · Выйти</button>
        </div>}
        {(displayMode || activeTab === "dashboard") && <div className="space-y-6"><div className="page-heading"><p className="eyebrow">Центр управления безопасностью</p><h2>Обзор ситуации</h2><p>Ключевые показатели состояния камер и событий за текущий период.</p></div><StatsOverview stats={globalStats} /><div className="quick-note"><span>Нужна детализация?</span><button onClick={() => setActiveTab("analytics")}>Открыть полную аналитику →</button></div></div>}
        {activeTab === "monitoring" && <DashboardPage onGlobalStatsUpdate={setGlobalStats} preferences={preferences} role={user?.role ?? "viewer"} displayMode={displayMode} />}
        {activeTab === "analytics" && <div className="space-y-6"><div className="page-heading"><p className="eyebrow">Отчёты и динамика</p><h2>Подробная аналитика</h2><p>Распределение событий, временная динамика и качество работы детектора.</p></div><StatsOverview stats={globalStats} detailed /></div>}
        {activeTab === "lab" && user?.role !== "viewer" && <LabPage />}
        {activeTab === "training" && user?.role === "admin" && <TrainingPage />}
        {activeTab === "settings" && user && <SettingsPage user={user} preferences={preferences} onPreferences={setPreferences} />}
      </main>
    </div>
  );
}
