import React from "react";
import { BarChart3, BrainCircuit, LayoutDashboard, LogOut, Settings, Shield, Upload, Video } from "lucide-react";
import { QuickNavigation } from "./QuickNavigation";

export type AppTab = "dashboard" | "monitoring" | "analytics" | "lab" | "training" | "settings";

interface NavbarProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  unacknowledgedCount: number;
  activeWeights: string;
  role: string;
  roleName?: string;
  permissions?: string[];
  displayName: string;
  onLogout: () => Promise<void>;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  unacknowledgedCount,
  activeWeights,
  role,
  roleName,
  permissions = [],
  displayName,
  onLogout,
}) => {
  const [loggingOut, setLoggingOut] = React.useState(false);
  const [logoutError, setLogoutError] = React.useState<string | null>(null);
  const tabs: Array<{ id: AppTab; label: string; icon: React.ElementType; badge?: number }> = [
    { id: "dashboard", label: "Обзор", icon: LayoutDashboard },
    { id: "monitoring", label: "Мониторинг", icon: Video, badge: unacknowledgedCount },
    { id: "analytics", label: "Аналитика", icon: BarChart3 },
    { id: "lab", label: "Проверка файлов", icon: Upload },
    { id: "training", label: "Обучение YOLO", icon: BrainCircuit },
    { id: "settings", label: "Настройки", icon: Settings },
  ];

  return (
    <header className="topbar z-40">
      <div className="topbar-panel">
        <div className="topbar-brand" title={`Веса модели: ${activeWeights}`}>
          <span className="topbar-brand-mark"><Shield aria-hidden="true" /></span>
          <div><h1>Школьный<br />мониторинг</h1><p>Центр безопасности</p></div>
        </div>
        <div className="topbar-navigation">
          <QuickNavigation activeTab={activeTab} onSelect={onSelectTab} destinations={tabs.filter(tab => (tab.id !== "training" || role === "admin") && (tab.id !== "lab" || role !== "viewer"))} />
          <nav aria-label="Основные разделы" className="topbar-nav">
            {tabs.filter(t => t.id !== "training" || role === "admin" || permissions.includes("train_model")).filter(t => t.id !== "lab" || role !== "viewer" || permissions.includes("analyze_files")).map(({ id, label, icon: Icon, badge }) => {
              const active = activeTab === id;
              return (
                <button
                   key={id}
                   aria-current={active ? "page" : undefined}
                  onClick={() => onSelectTab(id)}
                   className={`topbar-tab ${active ? "is-active" : ""}`}
                >
                   <Icon aria-hidden="true" />
                  <span>{label}</span>
                  {typeof badge === "number" && badge > 0 && (
                    <span
                      className="topbar-badge"
                    >
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="sidebar-model"><BrainCircuit size={18} aria-hidden="true" /><div><small>Модель детекции</small><strong title={activeWeights}>{activeWeights}</strong></div></div>
        <div className="topbar-actions">
          <span className="topbar-user" title={displayName}><strong>{displayName}</strong><small>{roleName ?? (role === "admin" ? "Администратор" : role === "operator" ? "Охрана" : role === "viewer" ? "Директор" : "Пользовательская роль")}</small></span>
          <button type="button" className="topbar-logout" aria-label={loggingOut ? "Выход из системы…" : "Выйти из системы"} title="Выйти из системы" disabled={loggingOut} onClick={async () => {
            setLoggingOut(true); setLogoutError(null);
            try { await onLogout(); }
            catch (e) { setLogoutError(e instanceof Error ? e.message : "Не удалось выйти"); }
            finally { setLoggingOut(false); }
          }}><LogOut aria-hidden="true" /><span>{loggingOut ? "Выход…" : "Выйти"}</span></button>
        </div>
        {logoutError && <p className="topbar-error" role="alert">{logoutError}</p>}
      </div>
    </header>
  );
};
