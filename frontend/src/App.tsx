import React, { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { api, DashboardStats, SystemStatus } from "./api/client";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AppTab, Navbar } from "./components/Navbar";
import { SettingsPanel } from "./components/SettingsPanel";
import { EmergencyBanner, EventToasts, LiveEventsProvider } from "./components/LiveEvents";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AuditPage } from "./pages/AuditPage";
import { DashboardPage } from "./pages/DashboardPage";
import { GuardPage } from "./pages/GuardPage";
import { LabPage } from "./pages/LabPage";
import { LoginPage } from "./pages/LoginPage";
import { OpsPage } from "./pages/OpsPage";
import { TrainingPage } from "./pages/TrainingPage";
import { UsersPage } from "./pages/UsersPage";
import { PrefsProvider, usePrefs } from "./prefs/PrefsContext";

const TAB_PERMISSION: Record<AppTab, string> = {
  dashboard: "cameras:view",
  guard: "guard:console",
  analytics: "analytics:view",
  lab: "media:check",
  training: "models:train",
  ops: "ops:manage",
  users: "users:manage",
  audit: "audit:view",
};

const AppShellInner: React.FC = () => {
  const { user, can } = useAuth();
  const { prefs } = usePrefs();
  const navSpace = prefs.mobile_bottom_nav ? "mobile-nav-space" : "";
  const [activeTab, setActiveTab] = useState<AppTab>("dashboard");
  const [globalStats, setGlobalStats] = useState<DashboardStats | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const permittedTabs = useMemo(
    () => (Object.keys(TAB_PERMISSION) as AppTab[]).filter((tab) => can(TAB_PERMISSION[tab])),
    [can]
  );

  useEffect(() => {
    if (!permittedTabs.includes(activeTab) && permittedTabs.length > 0) {
      setActiveTab(permittedTabs[0]);
    }
  }, [permittedTabs, activeTab]);

  useEffect(() => {
    if (user?.role === "guard" && can("guard:console")) {
      setActiveTab("guard");
    }
  }, [user?.role, can]);

  useEffect(() => {
    api.getStats().then(setGlobalStats).catch(() => {});
    api.getSystemStatus().then(setSystemStatus).catch(() => {});
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        permittedTabs={permittedTabs}
        unacknowledgedCount={globalStats?.unacknowledged_violations ?? 0}
        activeWeights={globalStats?.model.active_weights ?? systemStatus?.model.active_weights ?? "school_security_best.pt"}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <EmergencyBanner onOpenWall={() => setActiveTab("guard")} canClear={can("emergency:trigger")} />

      <main className={`flex-1 max-w-[1500px] w-full mx-auto px-3 sm:px-6 py-4 sm:py-7 ${navSpace}`}>
        {activeTab === "dashboard" && <DashboardPage onGlobalStatsUpdate={setGlobalStats} />}
        {activeTab === "guard" && <GuardPage onGlobalStatsUpdate={setGlobalStats} />}
        {activeTab === "analytics" && <AnalyticsPage />}
        {activeTab === "lab" && <LabPage />}
        {activeTab === "training" && <TrainingPage />}
        {activeTab === "ops" && <OpsPage />}
        {activeTab === "users" && <UsersPage />}
        {activeTab === "audit" && <AuditPage />}
      </main>

      <footer className={`border-t border-slate-800/80 bg-slate-950/80 ${navSpace}`}>
        <div className="max-w-[1500px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>
              {systemStatus?.project ?? "Аналитика безопасности школы"} · Лицей №6 «Перспектива» · v
              {systemStatus?.version ?? "2.0.0"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {systemStatus && (
              <>
                <span>
                  Сессия: <span className="text-slate-400">{systemStatus.auth.scheme}</span>
                </span>
                <span>
                  Трекинг: <span className="text-slate-400">{systemStatus.tracking.backend}</span> · выдержка{" "}
                  {systemStatus.tracking.dwell_threshold_sec.toFixed(0)} с
                </span>
                <span>
                  Gate: <span className="text-slate-400">mAP@50 ≥ baseline − {(systemStatus.validation_gate.map50_tolerance * 100).toFixed(0)} п.п.</span>
                </span>
              </>
            )}
            <span className="font-mono">{user?.username}</span>
          </div>
        </div>
      </footer>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <EventToasts />
    </div>
  );
};

const AppShell: React.FC = () => {
  const { prefs } = usePrefs();
  return (
    <LiveEventsProvider soundEnabled={prefs.sound_enabled} toastsEnabled={prefs.toasts_enabled}>
      <AppShellInner />
    </LiveEventsProvider>
  );
};

const Gate: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4 text-slate-400">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
        </div>
        <p className="text-sm">Проверка сессии…</p>
      </div>
    );
  }

  if (!user) return <LoginPage />;
  return (
    <PrefsProvider>
      <AppShell />
    </PrefsProvider>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
