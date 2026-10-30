import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera as CameraIcon, Play, Plus, RefreshCw, Search, X } from "lucide-react";
import { api, Camera, DashboardStats, Preferences, User, Violation } from "../api/client";
import { CameraCard } from "../components/CameraCard";
import { AddCameraModal } from "../components/AddCameraModal";
import { VIOLATION_META } from "../components/ViolationsTable";
import { VideoModal } from "../components/VideoModal";
import { CameraViewer } from "../components/CameraViewer";
import { CameraSettingsDialog } from "../components/CameraSettingsDialog";
import { ArchiveBrowser } from "../components/ArchiveBrowser";
import { FloorPlans } from "../components/FloorPlans";
import "../operations.css";
import { CameraFilter, filterCameras, matchesCameraFilter } from "../utils/cameraFilters";
import { canLeaveWorkspace } from "../utils/navigationGuard";
import { readMonitoringState } from "../utils/monitoringState";

const cameraFilters: Array<{ id: CameraFilter; label: string }> = [
  { id: "all", label: "Все камеры" }, { id: "online", label: "На связи" },
  { id: "offline", label: "Нет связи" }, { id: "threats", label: "С тревогами" },
];

interface DashboardPageProps {
  onGlobalStatsUpdate: (stats: DashboardStats) => void;
  preferences: Preferences;
  role: User["role"];
  permissions?: string[];
  displayMode?: boolean;
  storageKey?: string;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onGlobalStatsUpdate, preferences, role, permissions = [], displayMode = false, storageKey = "security:anonymous" }) => {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const surface = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [monitorView, setMonitorView] = useState("wall");
  const [local, setLocal] = useState<{ columns: number; pinned: number[]; autofocus: boolean }>(() => {
    try { return readMonitoringState(localStorage.getItem(storageKey)); } catch { return readMonitoringState(null); }
  });
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(local)); } catch { /* storage is optional */ } }, [local, storageKey]);
  useEffect(() => { const sync = () => setFullscreen(document.fullscreenElement === surface.current); document.addEventListener("fullscreenchange", sync); return () => document.removeEventListener("fullscreenchange", sync); }, []);
  const [cameraQuery, setCameraQuery] = useState("");
  const [cameraFilter, setCameraFilter] = useState<CameraFilter>("all");
  const [loaded, setLoaded] = useState(false);
  const visibleCameras = filterCameras(cameras, cameraQuery, cameraFilter).sort((a, b) => Number(local.pinned.includes(b.id)) - Number(local.pinned.includes(a.id)));

  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedCamera, setExpandedCamera] = useState<Camera | null>(null);
  const [settingsCamera, setSettingsCamera] = useState<Camera | null>(null);
  const [activeVideo, setActiveVideo] = useState<Violation | null>(null);
  const [latestAlert, setLatestAlert] = useState<Violation | null>(null);

  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const fetching = useRef(false);

  useEffect(() => {
    if (!displayMode || !latestAlert) return;
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 740;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.46);
      window.setTimeout(() => void context.close(), 600);
    } catch { /* Audio may be unavailable or blocked by the browser. */ }
  }, [displayMode, latestAlert]);

  useEffect(() => {
    const receive = (event: Event) => {
      const row = (event as CustomEvent<Violation>).detail;
      setLatestAlert(row);
      if (local.autofocus && !showAddModal && !expandedCamera && !settingsCamera && !activeVideo && !document.querySelector("dialog[open], [role=dialog]")) {
        const camera = cameras.find(item => item.id === row.camera_id);
        if (camera) setExpandedCamera(camera);
      }
    };
    window.addEventListener("incident-created", receive);
    return () => window.removeEventListener("incident-created", receive);
  }, [local.autofocus, cameras, showAddModal, expandedCamera, settingsCamera, activeVideo]);

  const fetchAll = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const [st, cams] = await Promise.all([api.getStats(), api.getCameras()]);
      if (!mounted.current) return;
      onGlobalStatsUpdate(st); setCameras(cams); setLoaded(true); setError(null);
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Нет связи с сервером"); }
    finally { fetching.current = false; }
  }, [onGlobalStatsUpdate]);

  useEffect(() => {
    mounted.current = true;
    fetchAll();
    const timer = setInterval(fetchAll, 2500);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [fetchAll]);

  const handleAcknowledge = async (id: number) => {
    try {
    const updated = await api.acknowledgeViolation(id);
    window.dispatchEvent(new Event("incident-updated"));

    if (activeVideo && activeVideo.id === id) {
      setActiveVideo(updated);
    }
    fetchAll();
    } catch (err) { setError(err instanceof Error ? err.message : "Ошибка подтверждения"); }
  };

  return (
    <div ref={surface} className="space-y-8 guard-surface" style={{ "--guard-columns": local.columns } as React.CSSProperties}>
      {error && <p role="alert" className="rounded-xl border border-red-700 bg-red-950 p-4 text-sm text-red-200">{error}</p>}
      {latestAlert && preferences.show_alerts && (
        <div className="bg-red-950/80 border border-red-500/50 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-500/20 text-red-300">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">
                Новое срабатывание YOLO:{" "}
                {VIOLATION_META[latestAlert.violation_type]?.title ?? latestAlert.violation_type}
              </p>
              <p className="text-xs text-red-200/80">
                {latestAlert.camera_name} ({latestAlert.camera_location}) · Уверенность{" "}
                {(latestAlert.confidence * 100).toFixed(1)}%
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setActiveVideo(latestAlert);
                setLatestAlert(null);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-semibold text-white transition"
            >
              <Play className="w-3.5 h-3.5" />
              Открыть видеозапись
            </button>
            <button
              onClick={() => setLatestAlert(null)}
              className="p-2 rounded-lg text-red-300 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="monitoring-title">Видеостена</h2>
            {!displayMode && <p className="text-xs text-slate-400">
              {cameras.filter(camera => camera.online).length} из {cameras.length} камер на связи. Откройте поток для просмотра крупным планом.
            </p>}
          </div>

          <div className="flex items-center gap-2.5">
            {!displayMode && <button
              onClick={fetchAll}
              className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 transition"
               title="Обновить данные"
               aria-label="Обновить данные камер"
            >
              <RefreshCw className="w-4 h-4" />
            </button>}
            {(role === "admin" || permissions.includes("manage_cameras")) && <button
              onClick={() => setShowAddModal(true)}
              className="accent-button inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Добавить камеру
            </button>}
          </div>
        </div>

        <div className="operations-toolbar">
          <button aria-pressed={monitorView === "wall"} onClick={() => { if (monitorView !== "wall" && canLeaveWorkspace()) setMonitorView("wall"); }}>Видеостена</button><button aria-pressed={monitorView === "plan"} onClick={() => setMonitorView("plan")}>План</button>
          <label>Раскладка<select value={local.columns} onChange={e => setLocal(old => ({ ...old, columns: Number(e.target.value) }))}><option value={1}>Крупно · 1</option><option value={2}>Стандарт · 2</option><option value={4}>Обзор · 4</option><option value={8}>Максимум · 8</option></select></label>
          <label><input type="checkbox" checked={local.autofocus} onChange={e => setLocal(old => ({ ...old, autofocus: e.target.checked }))} />Автофокус новых тревог</label>
          <button onClick={async () => { try { if (fullscreen) await document.exitFullscreen(); else await surface.current?.requestFullscreen(); } catch { setError("Полноэкранный режим недоступен в этом браузере"); } }}>{fullscreen ? "Выйти из режима охраны" : "Режим охраны · полный экран"}</button>
        </div>
        {monitorView === "plan" && <FloorPlans cameras={cameras} isAdmin={role === "admin"} onOpenCamera={setExpandedCamera} />}
        <div hidden={monitorView !== "wall"}>
        {!displayMode && <div className="camera-toolbar"><div className="camera-filter-tabs" role="group" aria-label="Фильтр состояния камер">{cameraFilters.map(({ id, label }) => <button type="button" key={id} aria-pressed={cameraFilter === id} onClick={() => setCameraFilter(id)}>{label}<span>{loaded ? cameras.filter(camera => matchesCameraFilter(camera, id)).length : "—"}</span></button>)}</div><label className="camera-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Поиск камеры по названию или расположению" placeholder="Найти камеру или зону" value={cameraQuery} onChange={event => setCameraQuery(event.target.value)} /></label></div>}
        {!displayMode && loaded && <p className="camera-result-count" role="status">Показано {visibleCameras.length} из {cameras.length}{error ? " · данные могут быть устаревшими" : ""}</p>}
        <div className={`camera-wall-grid columns-${preferences.columns}`}>
          {!loaded && <div className="camera-empty-state col-span-full"><CameraIcon size={30} aria-hidden="true" /><h3>{error ? "Не удалось загрузить камеры" : "Подключаемся к камерам…"}</h3><p>{error ? "Проверьте соединение с сервером и обновите данные." : "Получаем список источников и состояние видеопотоков."}</p></div>}
          {loaded && cameras.length === 0 && <div className="camera-empty-state col-span-full"><CameraIcon size={30} aria-hidden="true" /><h3>Здесь появятся камеры школы</h3><p>{role === "admin" || permissions.includes("manage_cameras") ? "Подключите камеру объекта или тестовый источник." : "Попросите администратора подключить камеры."}</p>{(role === "admin" || permissions.includes("manage_cameras")) && <button className="accent-button" onClick={() => setShowAddModal(true)}><Plus size={16} aria-hidden="true" />Добавить первую камеру</button>}</div>}
          {loaded && cameras.length > 0 && visibleCameras.length === 0 && <div className="camera-empty-state col-span-full"><Search size={30} aria-hidden="true" /><h3>Камер с такими параметрами нет</h3><p>Попробуйте другое название, расположение или состояние.</p><button className="quiet-button" onClick={() => { setCameraQuery(""); setCameraFilter("all"); }}>Сбросить фильтры</button></div>}
          {visibleCameras.map((cam) => (
            <div className="camera-pin-wrap" key={cam.id}><button className="camera-pin" aria-pressed={local.pinned.includes(cam.id)} aria-label={`Закрепить камеру ${cam.name}`} onClick={() => setLocal(old => ({ ...old, pinned: old.pinned.includes(cam.id) ? old.pinned.filter(id => id !== cam.id) : [...old.pinned, cam.id] }))}>{local.pinned.includes(cam.id) ? "★ Закреплена" : "☆ Закрепить"}</button><CameraCard
              camera={cam}
              canManage={role === "admin" || permissions.includes("manage_cameras")}
              onReconnect={async id => { try { await api.reconnectCamera(id); fetchAll(); } catch (err) { setError(err instanceof Error ? err.message : "Ошибка переподключения"); } }}
              onToggle={async (id) => {
                try {
                await api.toggleCamera(id);
                fetchAll();
                } catch (err) { setError(err instanceof Error ? err.message : "Ошибка управления камерой"); }
              }}
         onDelete={async (id) => {
                if (!window.confirm("Удалить камеру и её архив инцидентов?")) return;
                try {
                await api.deleteCamera(id);
                fetchAll();
                } catch (err) { setError(err instanceof Error ? err.message : "Ошибка удаления камеры"); }
              }}
              onSimulate={async (id, scenario) => {
                try {
                await api.simulateEvent(id, scenario);
                } catch (err) { setError(err instanceof Error ? err.message : "Ошибка симуляции"); }
              }}
              onExpand={setExpandedCamera}
              onSettings={role === "admin" && !displayMode ? setSettingsCamera : undefined}
            /></div>
          ))}
        </div></div>
      </section>

      {!displayMode && preferences.show_archive && <ArchiveBrowser key={storageKey} cameras={cameras} storageKey={storageKey} onOpenVideo={setActiveVideo} canExport={role === "admin" || permissions.includes("export_archive")} canReview={role === "admin" || permissions.includes("review_incidents")} canDelete={role === "admin" || permissions.includes("delete_incidents")} />}

      <AddCameraModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={async (payload) => {
          await api.addCamera(payload);
          await fetchAll();
        }}
      />

      <VideoModal
         canAcknowledge={role === "admin" || permissions.includes("review_incidents")}
        violation={activeVideo}
        onClose={() => setActiveVideo(null)}
        onAcknowledge={handleAcknowledge}
      />

      {expandedCamera && <CameraViewer camera={cameras.find(camera => camera.id === expandedCamera.id) ?? expandedCamera} onClose={() => setExpandedCamera(null)} />}
      {settingsCamera && role === "admin" && <CameraSettingsDialog camera={settingsCamera} onClose={() => setSettingsCamera(null)} onSaved={() => { void fetchAll(); }} />}
    </div>
  );
};
