import React from "react";
import { BrainCircuit, ExternalLink, Settings, Shield, Upload, Video } from "lucide-react";

export type AppTab = "dashboard" | "lab" | "training" | "settings";

interface NavbarProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  unacknowledgedCount: number;
  activeWeights: string;
  role: "admin" | "operator" | "viewer";
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  unacknowledgedCount,
  activeWeights,
  role,
}) => {
  const tabs: Array<{ id: AppTab; label: string; icon: React.ElementType; badge?: number }> = [
    { id: "dashboard", label: "Мониторинг и инциденты", icon: Video, badge: unacknowledgedCount },
    { id: "lab", label: "Проверка фото / видео", icon: Upload },
    { id: "training", label: "Обучение YOLO", icon: BrainCircuit },
    { id: "settings", label: "Настройки", icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">
                School Security Analytics
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                YOLO
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Веса модели: <span className="text-slate-300 font-mono">{activeWeights}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
            {tabs.filter(t => t.id !== "training" || role === "admin").filter(t => t.id !== "lab" || role !== "viewer").map(({ id, label, icon: Icon, badge }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => onSelectTab(id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium transition ${
                    active
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                  {typeof badge === "number" && badge > 0 && (
                    <span
                      className={`px-1.5 py-0.5 text-[11px] rounded-full font-semibold ${
                        active ? "bg-white/20 text-white" : "bg-red-500/20 text-red-300"
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            className="hidden lg:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-xs text-slate-300 transition"
          >
            Swagger API
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
          </a>
        </div>
      </div>
    </header>
  );
};
