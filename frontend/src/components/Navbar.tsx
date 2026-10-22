import React, { useState } from "react";
import {
  BadgeCheck,
  BrainCircuit,
  ChevronDown,
  ExternalLink,
  FileBarChart,
  LayoutGrid,
  LogOut,
  MoreHorizontal,
  Radio,
  ScrollText,
  Settings2,
  Shield,
  ShieldAlert,
  Upload,
  Users,
  Video,
  X,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { usePrefs } from "../prefs/PrefsContext";

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
  { id: "training", label: "Модели YOLO", shortLabel: "YOLO", icon: BrainCircuit },
  { id: "users", label: "Пользователи", shortLabel: "Люди", icon: Users },
  { id: "audit", label: "Журнал аудита", shortLabel: "Аудит", icon: ScrollText },
];

const ROLE_BADGE: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  admin: {
    label: "Администратор",
    className: "bg-brand-500/15 text-brand-300 border-brand-500/30",
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
  onOpenSettings: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  permittedTabs,
  unacknowledgedCount,
  activeWeights,
  onOpenSettings,
}) => {
  const { user, logout, can } = useAuth();
  const { prefs } = usePrefs();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const role = ROLE_BADGE[user?.role ?? "guard"] ?? ROLE_BADGE.guard;
  const RoleIcon = role.icon;
  const visibleTabs = TABS.filter((tab) => permittedTabs.includes(tab.id));
  const primaries = visibleTabs.slice(0, 4);
  const overflow = visibleTabs.slice(4);
  const useBottomNav = prefs.mobile_bottom_nav;

  const openSettings = () => {
    setMenuOpen(false);
    setMoreOpen(false);
    onOpenSettings();
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur-md">
        <div className="max-w-[1500px] mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white ring-1 ring-slate-700/70 shadow-sm overflow-hidden shrink-0 p-0.5">
              <img
                src="/brand/logo-192.png"
                alt="Лицей №6 «Перспектива»"
                width={40}
                height={40}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-[13px] sm:text-base font-bold tracking-tight text-ink truncate">
                  Аналитика безопасности школы
                </h1>
                <span className="hidden lg:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-brand-500/10 text-brand-300 border border-brand-500/25">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                  YOLOv8 активна
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-500 truncate">
                <span className="text-slate-400">Лицей №6 «Перспектива»</span> · веса:{" "}
                <span className="text-slate-400 font-mono">{activeWeights}</span>
              </p>
            </div>
          </div>

          {/* Табы: на телефоне их заменяет нижняя навигация */}
          <nav
            className={`${
              useBottomNav ? "hidden md:flex" : "flex"
            } order-3 lg:order-2 w-full lg:w-auto items-center gap-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800 overflow-x-auto`}
          >
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
                      ? "bg-brand-600 text-white shadow-sm shadow-black/30"
                      : "text-slate-400 hover:text-ink hover:bg-slate-800/70"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="hidden xl:inline">{shortLabel}</span>
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

          <div className="order-2 lg:order-3 flex items-center gap-1.5 sm:gap-2">
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

            <button
              onClick={openSettings}
              title="Настройки интерфейса"
              aria-label="Настройки интерфейса"
              className="p-2 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-ink transition"
            >
              <Settings2 className="w-4 h-4" />
            </button>

            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 pl-1.5 pr-2 sm:pr-2.5 py-1.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 transition"
              >
                <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${role.className}`}>
                  <RoleIcon className="w-4 h-4" />
                </div>
                <div className="text-left hidden sm:block">
                  <p className="text-[11px] font-semibold text-ink leading-tight max-w-[140px] truncate">
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
                      <p className="text-xs font-semibold text-ink">{user?.full_name}</p>
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
                      onClick={openSettings}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800 transition"
                    >
                      <Settings2 className="w-4 h-4" />
                      Настройки интерфейса
                    </button>
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

      {/* ── Нижняя навигация для телефона ─────────────────────────────────── */}
      {useBottomNav && (
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-800 bg-slate-950/95 backdrop-blur-md safe-bottom">
          <div className="flex items-stretch">
            {primaries.map(({ id, shortLabel, icon: Icon, badge }) => {
              const active = activeTab === id;
              const unack = badge === "unack" ? unacknowledgedCount : 0;
              return (
                <button
                  key={id}
                  onClick={() => onSelectTab(id)}
                  className={`relative flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-2 transition ${
                    active ? "text-brand-300" : "text-slate-400 active:bg-slate-900"
                  }`}
                >
                  {active && <span className="absolute top-0 inset-x-4 h-0.5 rounded-full bg-brand-400" />}
                  <span className="relative">
                    <Icon className="w-5 h-5" />
                    {unack > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-red-500 text-white text-[9px] font-semibold flex items-center justify-center">
                        {unack > 9 ? "9+" : unack}
                      </span>
                    )}
                  </span>
                  <span className="text-[9px] font-medium truncate max-w-full px-1">{shortLabel}</span>
                </button>
              );
            })}
            <button
              onClick={() => setMoreOpen(true)}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-2 transition ${
                overflow.some((t) => t.id === activeTab) || !primaries.some((t) => t.id === activeTab)
                  ? "text-brand-300"
                  : "text-slate-400 active:bg-slate-900"
              }`}
            >
              <MoreHorizontal className="w-5 h-5" />
              <span className="text-[9px] font-medium">Ещё</span>
            </button>
          </div>
        </nav>
      )}

      {/* Шторка «Ещё»: остальные разделы + настройки */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setMoreOpen(false)} aria-hidden />
          <div className="relative rounded-t-3xl border-t border-slate-800 bg-slate-900 p-4 safe-bottom max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-ink">Все разделы</p>
              <button
                onClick={() => setMoreOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800"
                aria-label="Закрыть меню"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {visibleTabs.map(({ id, label, icon: Icon, badge }) => {
                const active = activeTab === id;
                const unack = badge === "unack" ? unacknowledgedCount : 0;
                return (
                  <button
                    key={id}
                    onClick={() => {
                      onSelectTab(id);
                      setMoreOpen(false);
                    }}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[11px] font-medium transition ${
                      active
                        ? "border-brand-500/50 bg-brand-500/10 text-brand-200"
                        : "border-slate-800 bg-slate-950/60 text-slate-300"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="flex-1 min-w-0 truncate">{label}</span>
                    {unack > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 text-[9px] font-semibold">
                        {unack > 99 ? "99+" : unack}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2">
              <button
                onClick={openSettings}
                className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-[11px] text-slate-300"
              >
                <Settings2 className="w-4 h-4" /> Настройки интерфейса
              </button>
              <button
                onClick={() => {
                  setMoreOpen(false);
                  logout();
                }}
                className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[11px] text-red-300"
              >
                <LogOut className="w-4 h-4" /> Выйти из системы
              </button>
            </div>

            <p className="mt-3 text-center text-[10px] text-slate-500 flex items-center justify-center gap-1.5">
              <LayoutGrid className="w-3 h-3" />
              {user?.full_name || user?.username} · {role.label}
            </p>
          </div>
        </div>
      )}
    </>
  );
};
