import React, { useState } from "react";
import {
  BadgeCheck,
  BrainCircuit,
  ChevronDown,
  ExternalLink,
  FileBarChart,
  LogOut,
  Radio,
  ScrollText,
  Shield,
  ShieldAlert,
  Upload,
  Users,
  Video,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";

export type AppTab =
  | "dashboard"
  | "guard"
  | "analytics"
  | "lab"
  | "training"
  | "users"
  | "audit";

interface TabMeta {
  id: AppTab;
  label: string;
  shortLabel: string;
  icon: React.ElementType;
  badge?: "unack";
}

const TABS: TabMeta[] = [
  { id: "dashboard", label: "Мониторинг и инциденты", shortLabel: "Мониторинг", icon: Video, badge: "unack" },
  { id: "guard", label: "КПП и тревоги", shortLabel: "КПП", icon: ShieldAlert, badge: "unack" },
  { id: "analytics", label: "Аналитика", shortLabel: "Аналитика", icon: FileBarChart },
  { id: "lab", label: "Проверка медиа", shortLabel: "Медиа", icon: Upload },
  { id: "training", label: "Дообучение YOLOv8", shortLabel: "YOLOv8", icon: BrainCircuit },
  { id: "users", label: "Пользователи", shortLabel: "Люди", icon: Users },
  { id: "audit", label: "Журнал аудита", shortLabel: "Аудит", icon: ScrollText },
];

const ROLE_BADGE: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  admin: {
    label: "Администратор",
    className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    icon: Shield,
  },
  director: {
    label: "Директор",
    className: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    icon: BadgeCheck,
  },
  guard: {
    label: "Охранник КПП",
    className: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    icon: ShieldAlert,
  },
};

interface NavbarProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  permittedTabs: AppTab[];
  unacknowledgedCount: number;
  activeWeights: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  permittedTabs,
  unacknowledgedCount,
  activeWeights,
}) => {
  const { user, logout, can } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const role = ROLE_BADGE[user?.role ?? "guard"] ?? ROLE_BADGE.guard;
  const RoleIcon = role.icon;
  const visibleTabs = TABS.filter((tab) => permittedTabs.includes(tab.id));

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur-md">
      <div className="max-w-[1500px] mx-auto px-3 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <Shield className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-white truncate">
                School Security Analytics
              </h1>
              <span className="hidden md:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                YOLOv8 Active
              </span>
            </div>
            <p className="text-[11px] text-slate-500 truncate">
              Веса: <span className="text-slate-400 font-mono">{activeWeights}</span>
            </p>
          </div>
        </div>

        <nav className="order-3 lg:order-2 w-full lg:w-auto flex items-center gap-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800 overflow-x-auto">
          {visibleTabs.map(({ id, label, shortLabel, icon: Icon, badge }) => {
            const active = activeTab === id;
            const unack = badge === "unack" ? unacknowledgedCount : 0;
            return (
              <button
                key={id}
                onClick={() => onSelectTab(id)}
                title={label}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-lg text-[11px] sm:text-xs font-medium transition whitespace-nowrap ${
                  active
                    ? "bg-indigo-600 text-white shadow-sm shadow-indigo-950"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/70"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">{shortLabel}</span>
                {unack > 0 && (
                  <span
                    className={`px-1.5 py-0.5 text-[10px] rounded-full font-semibold ${
                      active ? "bg-white/20 text-white" : "bg-red-500/20 text-red-300"
                    }`}
                  >
                    {unack > 99 ? "99+" : unack}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="order-2 lg:order-3 flex items-center gap-2">
          {can("users:manage") && (
            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="hidden xl:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-[11px] text-slate-300 transition"
            >
              Swagger API
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </a>
          )}

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 transition"
            >
              <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${role.className}`}>
                <RoleIcon className="w-4 h-4" />
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-[11px] font-semibold text-white leading-tight max-w-[140px] truncate">
                  {user?.full_name || user?.username}
                </p>
                <p className="text-[10px] text-slate-500 leading-tight">{role.label}</p>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition ${menuOpen ? "rotate-180" : ""}`} />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-64 z-50 rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/60 p-2">
                  <div className="px-3 py-2 border-b border-slate-800 mb-1">
                    <p className="text-xs font-semibold text-white">{user?.full_name}</p>
                    <p className="text-[11px] text-slate-400 font-mono">@{user?.username}</p>
                    <span className={`inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[10px] border ${role.className}`}>
                      <RoleIcon className="w-3 h-3" />
                      {role.label}
                    </span>
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Права доступа</p>
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      {user?.permissions?.length ?? 0} разрешений · {user?.is_demo ? "демо-аккаунт" : "учётная запись"}
                    </p>
                  </div>
                  <button
                    onClick={() => setMenuOpen(false)}
                    className="hidden"
                    aria-hidden
                  />
                  <a
                    href="/docs"
                    target="_blank"
                    rel="noreferrer"
                    className="xl:hidden flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <Radio className="w-4 h-4" /> Swagger API
                  </a>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-red-300 hover:bg-red-500/10 transition"
                  >
                    <LogOut className="w-4 h-4" />
                    Выйти из системы
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
