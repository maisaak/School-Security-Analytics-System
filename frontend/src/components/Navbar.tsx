import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  DatabaseZap,
  ExternalLink,
  GraduationCap,
  LayoutGrid,
  LogOut,
  MoreHorizontal,
  ScrollText,
  Search,
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
  | "ops"
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
  { id: "guard", label: "КПП, тревоги и видеостена", shortLabel: "КПП", icon: ShieldAlert, badge: "unack" },
  { id: "analytics", label: "Аналитика и отчёты", shortLabel: "Аналитика", icon: BarChart3 },
  { id: "lab", label: "Проверка медиа", shortLabel: "Медиа", icon: Upload },
  { id: "training", label: "Модели YOLO", shortLabel: "YOLO", icon: BrainCircuit },
  { id: "ops", label: "Эксплуатация", shortLabel: "Эксплуатация", icon: DatabaseZap },
  { id: "users", label: "Пользователи", shortLabel: "Люди", icon: Users },
  { id: "audit", label: "Журнал аудита", shortLabel: "Аудит", icon: ScrollText },
];

/** Группы разделов в боковой навигации. */
const GROUPS: { label: string; ids: AppTab[] }[] = [
  { label: "Наблюдение", ids: ["dashboard", "guard", "analytics"] },
  { label: "Модели и медиа", ids: ["lab", "training"] },
  { label: "Система", ids: ["ops", "users", "audit"] },
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
    icon: GraduationCap,
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

const Brand: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button onClick={onClick} className="flex min-w-0 items-center gap-2.5 text-left sm:gap-3">
    <div
      className="rounded-xl bg-white ring-1 ring-slate-700/70 shadow-sm overflow-hidden p-0.5"
      style={{ width: 38, height: 38, flex: "0 0 auto" }}
    >
      <img
        src="/brand/logo-192.png"
        alt="Лицей №6 «Перспектива»"
        width={38}
        height={38}
        className="object-contain"
        style={{ width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%", display: "block" }}
      />
    </div>
    <div className="min-w-0">
      <p className="truncate text-[13px] font-bold tracking-tight text-ink sm:text-[15px]">
        Аналитика безопасности школы
      </p>
      <p className="truncate text-[10px] text-slate-500 sm:text-[11px]">
        <span className="text-slate-400">Лицей №6 «Перспектива»</span>
      </p>
    </div>
  </button>
);

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const role = ROLE_BADGE[user?.role ?? "guard"] ?? ROLE_BADGE.guard;
  const RoleIcon = role.icon;
  const visibleTabs = TABS.filter((tab) => permittedTabs.includes(tab.id));
  const bottomNav = useMemo(() => visibleTabs.slice(0, 3), [visibleTabs]);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Ctrl+K / ⌘K — быстрый переход в любой раздел
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        setPaletteQuery("");
        setPaletteIndex(0);
      } else if (event.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteItems = useMemo(() => {
    const items: { key: string; label: string; hint: string; icon: React.ElementType; run: () => void }[] = [
      ...visibleTabs.map((tab) => ({
        key: tab.id,
        label: tab.label,
        hint: "Раздел",
        icon: tab.icon,
        run: () => goTo(tab.id),
      })),
      { key: "settings", label: "Настройки интерфейса", hint: "Тема, акцент, KPI", icon: Settings2, run: () => openSettings() },
      { key: "logout", label: "Выйти из системы", hint: "Завершить сессию", icon: LogOut, run: logout },
    ];
    const query = paletteQuery.trim().toLowerCase();
    return query
      ? items.filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(query))
      : items;
  }, [visibleTabs, paletteQuery]);

  const openSettings = () => {
    setMenuOpen(false);
    setMoreOpen(false);
    onOpenSettings();
  };

  const goTo = (tab: AppTab) => {
    onSelectTab(tab);
    setMenuOpen(false);
    setMoreOpen(false);
  };

  const unackFor = (tab: TabMeta) => (tab.badge === "unack" ? unacknowledgedCount : 0);

  const UserMenu: React.FC<{ align?: "left" | "right"; dropUp?: boolean }> = ({
    align = "right",
    dropUp = false,
  }) => (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((value) => !value)}
        className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 py-1.5 pl-1.5 pr-2 transition hover:border-slate-700 hover:bg-slate-800/80 sm:pr-2.5"
      >
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg border ${role.className}`}>
          <RoleIcon className="h-4 w-4" />
        </div>
        <div className="hidden text-left sm:block">
          <p className="max-w-[140px] truncate text-[11px] font-semibold leading-tight text-ink">
            {user?.full_name || user?.username}
          </p>
          <p className="text-[10px] leading-tight text-slate-500">{role.label}</p>
        </div>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-500 transition ${menuOpen ? "rotate-180" : ""}`} />
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div
            className={`absolute z-50 w-64 rounded-2xl border border-slate-800 bg-slate-900 p-2 shadow-2xl shadow-black/60 backdrop-blur ${
              dropUp ? "bottom-full mb-2" : "top-full mt-2"
            } ${align === "right" ? "right-0" : "left-0"}`}
          >
            <div className="mb-1 border-b border-slate-800 px-3 py-2">
              <p className="text-xs font-semibold text-ink">{user?.full_name}</p>
              <p className="font-mono text-[11px] text-slate-400">@{user?.username}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${role.className}`}>
                  <RoleIcon className="h-3 w-3" />
                  {role.label}
                </span>
                {user?.totp_enabled ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" /> 2FA
                  </span>
                ) : (
                  <button
                    onClick={openSettings}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300"
                  >
                    Включить 2FA
                  </button>
                )}
              </div>
            </div>
            <div className="px-3 py-2">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Права доступа</p>
              <button
                onClick={openSettings}
                className="text-[10px] text-slate-300 underline decoration-dotted underline-offset-2 hover:text-ink"
              >
                {user?.permissions?.length ?? 0} разрешений · посмотреть
              </button>
            </div>
            <button
              onClick={openSettings}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-300 transition hover:bg-slate-800"
            >
              <Settings2 className="h-4 w-4" />
              Настройки и безопасность
            </button>
            <a
              href="/docs"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
            >
              <LayoutGrid className="h-4 w-4" /> Swagger API
            </a>
            <button
              onClick={() => {
                setMenuOpen(false);
                logout();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-red-300 transition hover:bg-red-500/10"
            >
              <LogOut className="h-4 w-4" />
              Выйти из системы
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      {/* ── Боковая навигация (десктоп) ───────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col border-r border-slate-800/80 glass-bar px-3 py-4 lg:flex">
        <div className="px-2">
          <Brand onClick={() => goTo(visibleTabs[0]?.id ?? "dashboard")} />
        </div>

        <button
          onClick={() => {
            setPaletteOpen(true);
            setPaletteQuery("");
            setPaletteIndex(0);
          }}
          className="mt-4 flex w-full items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-400 transition hover:border-slate-700 hover:text-slate-200"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Перейти к разделу…</span>
          <kbd className="rounded border border-slate-700 bg-slate-950/70 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">
            Ctrl K
          </kbd>
        </button>

        <nav className="mt-4 flex-1 space-y-5 overflow-y-auto px-1 pb-2" aria-label="Разделы системы">
          {GROUPS.map((group) => {
            const items = group.ids
              .map((id) => visibleTabs.find((tab) => tab.id === id))
              .filter((tab): tab is TabMeta => Boolean(tab));
            if (!items.length) return null;
            return (
              <div key={group.label}>
                <p className="mb-1.5 px-3 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {items.map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    const unack = unackFor(tab);
                    return (
                      <button
                        key={tab.id}
                        onClick={() => goTo(tab.id)}
                        title={tab.label}
                        aria-current={active ? "page" : undefined}
                        className={`nav-item ${active ? "nav-item-active" : ""}`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                        {unack > 0 && (
                          <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
                            {unack > 99 ? "99+" : unack}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-slate-800/80 px-1 pt-3">
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="chip chip-live">YOLOv8 активна</span>
              <Activity className="h-3.5 w-3.5 text-brand-400" />
            </div>
            <p className="mt-2 truncate font-mono text-[10px] text-slate-500" title={activeWeights}>
              {activeWeights}
            </p>
          </div>

          <button onClick={openSettings} className="nav-item">
            <Settings2 className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Настройки интерфейса</span>
          </button>

          {can("users:manage") && (
            <a href="/docs" target="_blank" rel="noreferrer" className="nav-item">
              <ExternalLink className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">Swagger API</span>
            </a>
          )}

          <div className="pt-1">
            <UserMenu align="left" dropUp />
          </div>
        </div>
      </aside>

      {/* ── Шапка (мобильная) ────────────────────────────────────────── */}
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur-md transition-colors lg:hidden ${
          scrolled ? "border-slate-800 bg-slate-950/95 shadow-lg shadow-black/20" : "border-transparent bg-slate-950/80"
        }`}
      >
        <div className="mx-auto max-w-[1500px] px-3 py-2.5 sm:px-6">
          <div className="flex items-center justify-between gap-2">
            <Brand onClick={() => goTo(visibleTabs[0]?.id ?? "dashboard")} />

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <button
                onClick={() => {
                  setPaletteOpen(true);
                  setPaletteQuery("");
                  setPaletteIndex(0);
                }}
                title="Поиск по разделам (Ctrl+K)"
                aria-label="Поиск по разделам"
                className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-300 transition hover:border-slate-700 hover:bg-slate-800 hover:text-ink"
              >
                <Search className="h-4 w-4" />
              </button>
              <button
                onClick={openSettings}
                title="Настройки интерфейса"
                aria-label="Настройки интерфейса"
                className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-300 transition hover:border-slate-700 hover:bg-slate-800 hover:text-ink"
              >
                <Settings2 className="h-4 w-4" />
              </button>
              <UserMenu />
            </div>
          </div>
        </div>
      </header>

      {/* ── Нижняя навигация (мобильная) ─────────────────────────────── */}
      {prefs.mobile_bottom_nav && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
          <div className="flex items-stretch">
            {bottomNav.map(({ id, shortLabel, icon: Icon, badge }) => {
              const active = activeTab === id;
              const unack = badge === "unack" ? unacknowledgedCount : 0;
              return (
                <button
                  key={id}
                  onClick={() => goTo(id)}
                  className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 transition ${
                    active ? "text-brand-300" : "text-slate-400 active:bg-slate-900"
                  }`}
                >
                  {active && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-brand-400" />}
                  <Icon className="h-5 w-5" />
                  <span className="max-w-full truncate px-1 text-[9px] font-medium">{shortLabel}</span>
                  {unack > 0 && (
                    <span className="absolute right-1/4 top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white">
                      {unack > 9 ? "9+" : unack}
                    </span>
                  )}
                </button>
              );
            })}
            <button
              onClick={() => setMoreOpen(true)}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-slate-400 active:bg-slate-900"
            >
              <MoreHorizontal className="h-5 w-5" />
              <span className="text-[9px] font-medium">Ещё</span>
            </button>
          </div>
        </nav>
      )}

      {/* ── Шторка «Все разделы» ─────────────────────────────────────── */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm md:hidden">
          <div className="absolute inset-0" onClick={() => setMoreOpen(false)} />
          <div className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-3xl border-t border-slate-800 bg-slate-950 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-700" />
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">Все разделы</p>
              <button
                onClick={() => setMoreOpen(false)}
                aria-label="Закрыть меню"
                className="rounded-lg p-1.5 text-slate-400 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {visibleTabs.map(({ id, label, icon: Icon, badge }) => {
                const unack = badge === "unack" ? unacknowledgedCount : 0;
                return (
                  <button
                    key={id}
                    onClick={() => goTo(id)}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-3 text-left transition ${
                      activeTab === id
                        ? "border-brand-500/50 bg-brand-500/10 text-brand-200"
                        : "border-slate-800 bg-slate-900 text-slate-300"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-[11px] font-medium leading-tight">{label}</span>
                    {unack > 0 && (
                      <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-red-300">
                        {unack}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={openSettings}
                className="flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-3 py-2.5 text-[11px] font-medium text-white transition hover:bg-brand-500"
              >
                <Settings2 className="h-4 w-4" /> Настройки интерфейса
              </button>
              <button
                onClick={() => {
                  setMoreOpen(false);
                  logout();
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-red-500/30 px-3 py-2.5 text-[11px] font-medium text-red-300"
              >
                <LogOut className="h-4 w-4" /> Выйти из системы
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
              <span className="chip chip-live">YOLOv8 активна</span>
              <span className="truncate pl-2 font-mono text-[10px] text-slate-500">{activeWeights}</span>
            </div>
            {user?.totp_enabled ? (
              <p className="mt-3 flex items-center gap-1.5 text-[10px] text-emerald-300">
                <CheckCircle2 className="h-3 w-3" /> Двухфакторная аутентификация включена
              </p>
            ) : (
              <p className="mt-3 text-[10px] text-slate-500">
                Рекомендуем включить 2FA в «Настройках» — это обязательное требование для администраторов.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Палитра команд (Ctrl+K) ──────────────────────────────────── */}
      {paletteOpen && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 p-3 pt-[12vh] backdrop-blur-sm sm:p-6">
          <div className="absolute inset-0" onClick={() => setPaletteOpen(false)} />
          <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/60">
            <div className="flex items-center gap-2 border-b border-slate-800 px-3.5 py-3">
              <Search className="h-4 w-4 text-slate-500" />
              <input
                autoFocus
                value={paletteQuery}
                onChange={(event) => {
                  setPaletteQuery(event.target.value);
                  setPaletteIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setPaletteIndex((index) => Math.min(paletteItems.length - 1, index + 1));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setPaletteIndex((index) => Math.max(0, index - 1));
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    paletteItems[paletteIndex]?.run();
                    setPaletteOpen(false);
                  }
                }}
                placeholder="Найти раздел, настройки или выход…"
                className="flex-1 bg-transparent text-sm text-ink placeholder:text-slate-600 focus:outline-none"
              />
              <kbd className="rounded border border-slate-700 bg-slate-950/70 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">
                Esc
              </kbd>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-1.5">
              {paletteItems.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-slate-500">Ничего не найдено</p>
              )}
              {paletteItems.map((item, index) => {
                const Icon = item.icon;
                const active = index === paletteIndex;
                return (
                  <button
                    key={item.key}
                    onMouseEnter={() => setPaletteIndex(index)}
                    onClick={() => {
                      item.run();
                      setPaletteOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition ${
                      active ? "bg-brand-500/10 text-brand-200" : "text-slate-300 hover:bg-slate-800/70"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-xs font-medium">{item.label}</span>
                    <span className="text-[10px] text-slate-500">{item.hint}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t border-slate-800 px-3.5 py-2 text-[10px] text-slate-500">
              <span>↑ ↓ — навигация · Enter — открыть</span>
              <span>Ctrl K — закрыть</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
