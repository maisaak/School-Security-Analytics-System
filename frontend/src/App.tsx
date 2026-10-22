import React, { useEffect, useMemo, useState } from "react";
import { Activity, Cpu, Loader2, ShieldCheck } from "lucide-react";
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

const TAB_IDS = Object.keys(TAB_PERMISSION) as AppTab[];

const readTabFromHash = (): AppTab => {
  if (typeof window === "undefined") return "dashboard";
  const hash = window.location.hash.replace(/^#/, "");
  return (TAB_IDS as string[]).includes(hash) ? (hash as AppTab) : "dashboard";
};

const AppShellInner: React.FC = () => {
  const { user, can } = useAuth();
  const { prefs } = usePrefs();
  const navSpace = prefs.mobile_bottom_nav ? "mobile-nav-space" : "";
  const [activeTab, setActiveTab] = useState<AppTab>(readTabFromHash);
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

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (window.location.hash !== `#${activeTab}`) {
      window.history.replaceState(null, "", `#${activeTab}`);
    }
  }, [activeTab]);

  // Ссылку на раздел можно отправить коллеге: #guard, #analytics и т.д.
  useEffect(() => {
    const onHashChange = () => {
      const tab = readTabFromHash();
      if (permittedTabs.includes(tab)) setActiveTab(tab);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [permittedTabs]);

  return (
    <div className="app-backdrop min-h-screen text-slate-100">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-xl focus:bg-brand-600 focus:px-3 focus:py-2 focus:text-xs focus:font-medium focus:text-white"
      >
        Перейти к содержимому
      </a>
      <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        permittedTabs={permittedTabs}
        unacknowledgedCount={globalStats?.unacknowledged_violations ?? 0}
        activeWeights={globalStats?.model.active_weights ?? systemStatus?.model.active_weights ?? "school_security_best.pt"}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="flex min-h-screen flex-col lg:pl-[264px]">
        <EmergencyBanner onOpenWall={() => setActiveTab("guard")} canClear={can("emergency:trigger")} />

        <main
          id="main"
          className={`mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-6 sm:py-6 lg:px-8 ${navSpace}`}
        >
          <div key={activeTab} className="fade-up">
            {activeTab === "dashboard" && <DashboardPage onGlobalStatsUpdate={setGlobalStats} />}
            {activeTab === "guard" && <GuardPage onGlobalStatsUpdate={setGlobalStats} />}
            {activeTab === "analytics" && <AnalyticsPage />}
            {activeTab === "lab" && <LabPage />}
            {activeTab === "training" && <TrainingPage />}
            {activeTab === "ops" && <OpsPage />}
            {activeTab === "users" && <UsersPage />}
            {activeTab === "audit" && <AuditPage />}
          </div>
        </main>

        <footer className={`border-t border-slate-800/70 bg-slate-950/50 ${navSpace}`}>
          <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-4 text-[10.5px] text-slate-500 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-brand-500/20 bg-brand-500/10">
                <ShieldCheck className="h-3.5 w-3.5 text-brand-400" />
              </span>
              <span>
                {systemStatus?.project ?? "Аналитика безопасности школы"} · Лицей №6 «Перспектива» · v
                {systemStatus?.version ?? "2.1"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {systemStatus && (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <Activity className="h-3 w-3 text-slate-600" />
                    Сессия: <span className="text-slate-400">{systemStatus.auth.scheme}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Cpu className="h-3 w-3 text-slate-600" />
                    Трекинг: <span className="text-slate-400">{systemStatus.tracking.backend}</span> · выдержка{" "}
                    {systemStatus.tracking.dwell_threshold_sec.toFixed(0)} с
                  </span>
                  <span className="hidden sm:inline">
                    Gate:{" "}
                    <span className="text-slate-400">
                      mAP@50 ≥ baseline − {(systemStatus.validation_gate.map50_tolerance * 100).toFixed(0)} п.п.
                    </span>
                  </span>
                </>
              )}
              <span className="rounded-full border border-slate-800 bg-slate-900/70 px-2 py-0.5 font-mono text-slate-400">
                {user?.username}
              </span>
            </div>
          </div>
        </footer>
      </div>

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
      <div className="app-backdrop flex min-h-screen flex-col items-center justify-center gap-4 text-slate-400">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-500/25 bg-brand-500/10">
          <Loader2 className="h-6 w-6 animate-spin text-brand-400" />
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
