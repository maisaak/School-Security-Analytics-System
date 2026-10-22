import React, { useEffect, useState } from "react";
import { api, DashboardStats } from "./api/client";
import { AppTab, Navbar } from "./components/Navbar";
import { DashboardPage } from "./pages/DashboardPage";
import { LabPage } from "./pages/LabPage";
import { TrainingPage } from "./pages/TrainingPage";

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("dashboard");
  const [globalStats, setGlobalStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    api.getStats().then(setGlobalStats).catch(() => {});
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        unacknowledgedCount={globalStats?.unacknowledged_violations ?? 0}
        activeWeights={globalStats?.model.active_weights ?? "school_security_best.pt"}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {activeTab === "dashboard" && <DashboardPage onGlobalStatsUpdate={setGlobalStats} />}
        {activeTab === "lab" && <LabPage />}
        {activeTab === "training" && <TrainingPage />}
      </main>
    </div>
  );
}
