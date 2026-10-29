import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Play, Plus, RefreshCw, X } from "lucide-react";
import { api, Camera, DashboardStats, Preferences, User, Violation } from "../api/client";
import { CameraCard } from "../components/CameraCard";
import { AddCameraModal } from "../components/AddCameraModal";
import { VIOLATION_META, ViolationsTable } from "../components/ViolationsTable";
import { VideoModal } from "../components/VideoModal";

interface DashboardPageProps {
  onGlobalStatsUpdate: (stats: DashboardStats) => void;
  preferences: Preferences;
  role: User["role"];
  permissions?: string[];
  displayMode?: boolean;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onGlobalStatsUpdate, preferences, role, permissions = [], displayMode = false }) => {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);

  const [filterType, setFilterType] = useState("");
  const [filterCameraId, setFilterCameraId] = useState<number | undefined>(undefined);
  const [onlyUnack, setOnlyUnack] = useState(false);
  const [reviewStatus, setReviewStatus] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedCamera, setExpandedCamera] = useState<Camera | null>(null);
  const [activeVideo, setActiveVideo] = useState<Violation | null>(null);
  const [latestAlert, setLatestAlert] = useState<Violation | null>(null);
  const highestSeenId = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const fetchAll = useCallback(async () => {
    try {
      const [st, cams, viols] = await Promise.all([
        api.getStats(),
        api.getCameras(),
        api.getViolations({
          violation_type: filterType || undefined,
          camera_id: filterCameraId,
          review_status: reviewStatus || undefined,
          unacknowledged_only: onlyUnack,
        }),
      ]);
      onGlobalStatsUpdate(st);
      setCameras(cams);
      setViolations(viols);
      setError(null);

      if (viols.length > 0) {
        const newest = viols[0];
        if (highestSeenId.current !== null && newest.id > highestSeenId.current) {
          setLatestAlert(newest);
        }
        if (highestSeenId.current === null || newest.id > highestSeenId.current) {
          highestSeenId.current = newest.id;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Нет связи с сервером");
    }
  }, [filterType, filterCameraId, reviewStatus, onlyUnack, onGlobalStatsUpdate]);

  useEffect(() => {
    fetchAll();
    const timer = setInterval(fetchAll, 2500);
    return () => clearInterval(timer);
  }, [fetchAll]);

  const handleAcknowledge = async (id: number) => {
    try {
    const updated = await api.acknowledgeViolation(id);
    setViolations((prev) => prev.map((v) => (v.id === id ? updated : v)));
    if (activeVideo && activeVideo.id === id) {
      setActiveVideo(updated);
    }
    fetchAll();
    } catch (err) { setError(err instanceof Error ? err.message : "Ошибка подтверждения"); }
  };

  const handleReview = async (id: number, status: Violation["review_status"], comment: string) => {
    try {
      const updated = await api.reviewViolation(id, status, comment);
      setViolations((prev) => prev.map((v) => (v.id === id ? updated : v)));
      if (activeVideo?.id === id) setActiveVideo(updated);
      fetchAll();
    } catch (err) { setError(err instanceof Error ? err.message : "Ошибка изменения статуса"); }
  };

  return (
    <div className="space-y-8">
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
            <h2 className={displayMode ? "text-2xl font-semibold text-white" : "text-lg font-semibold text-white"}>Видеостена реального времени</h2>
            {!displayMode && <p className="text-xs text-slate-400">
              Потоковый мониторинг камер школы с автоматической классификацией объектов и проверкой бесхозных сумок
            </p>}
          </div>

          <div className="flex items-center gap-2.5">
            {!displayMode && <button
              onClick={fetchAll}
              className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 transition"
              title="Обновить данные"
            >
              <RefreshCw className="w-4 h-4" />
            </button>}
            {role === "admin" && <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-medium text-white transition shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Добавить камеру
            </button>}
          </div>
        </div>

        <div className={`grid gap-5 ${ {1: "grid-cols-1", 2: "grid-cols-1 md:grid-cols-2", 3: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3", 4: "grid-cols-1 md:grid-cols-2 xl:grid-cols-4"}[preferences.columns] }`}>
          {cameras.length === 0 && <div className="col-span-full rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-10 text-center"><h3 className="font-semibold">Камеры ещё не добавлены</h3><p className="text-sm text-slate-400 mt-2">{role === "admin" ? "Добавьте RTSP-камеру или тестовый источник, чтобы начать мониторинг." : "Попросите администратора подключить камеры."}</p></div>}
          {cameras.map((cam) => (
            <CameraCard
              key={cam.id}
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
            />
          ))}
        </div>
      </section>

      {!displayMode && preferences.show_archive && <ViolationsTable
         canAcknowledge={role === "admin" || permissions.includes("review_incidents")}
         canDelete={role === "admin" || permissions.includes("manage_cameras")}
        violations={violations}
        cameras={cameras}
        filterType={filterType}
        filterCameraId={filterCameraId}
        onlyUnack={onlyUnack}
        reviewStatus={reviewStatus}
        onChangeType={setFilterType}
        onChangeCamera={setFilterCameraId}
        onChangeUnack={setOnlyUnack}
        onChangeReviewStatus={setReviewStatus}
        onOpenVideo={setActiveVideo}
        onAcknowledge={handleAcknowledge}
        onReview={handleReview}
        onDelete={async (id) => {
          if (!window.confirm("Удалить инцидент и его медиафайлы?")) return;
          try {
          await api.deleteViolation(id);
          fetchAll();
          } catch (err) { setError(err instanceof Error ? err.message : "Ошибка удаления инцидента"); }
         }}
         onExport={() => api.exportViolations({ violation_type: filterType || undefined, camera_id: filterCameraId, review_status: reviewStatus || undefined, unacknowledged_only: onlyUnack }).catch(err => setError(err instanceof Error ? err.message : "Ошибка экспорта архива"))}
       />}

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

      {expandedCamera && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-5xl w-full p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-white">{expandedCamera.name}</h3>
                <p className="text-xs text-slate-400">{expandedCamera.location}</p>
              </div>
              <button
                onClick={() => setExpandedCamera(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={`/api/cameras/${expandedCamera.id}/stream`}
              alt={expandedCamera.name}
              className="w-full rounded-xl bg-black aspect-video object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
};
