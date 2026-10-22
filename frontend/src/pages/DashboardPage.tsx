import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Play, Plus, RefreshCw, X } from "lucide-react";
import { api, Camera, DashboardStats, Violation } from "../api/client";
import { StatsOverview } from "../components/StatsOverview";
import { CameraCard } from "../components/CameraCard";
import { AddCameraModal } from "../components/AddCameraModal";
import { VIOLATION_META, ViolationsTable } from "../components/ViolationsTable";
import { VideoModal } from "../components/VideoModal";

interface DashboardPageProps {
  onGlobalStatsUpdate: (stats: DashboardStats) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onGlobalStatsUpdate }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);

  const [filterType, setFilterType] = useState("");
  const [filterCameraId, setFilterCameraId] = useState<number | undefined>(undefined);
  const [onlyUnack, setOnlyUnack] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedCamera, setExpandedCamera] = useState<Camera | null>(null);
  const [activeVideo, setActiveVideo] = useState<Violation | null>(null);
  const [latestAlert, setLatestAlert] = useState<Violation | null>(null);
  const highestSeenId = useRef<number | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [st, cams, viols] = await Promise.all([
        api.getStats(),
        api.getCameras(),
        api.getViolations({
          violation_type: filterType || undefined,
          camera_id: filterCameraId,
          unacknowledged_only: onlyUnack,
        }),
      ]);
      setStats(st);
      onGlobalStatsUpdate(st);
      setCameras(cams);
      setViolations(viols);

      if (viols.length > 0) {
        const newest = viols[0];
        if (highestSeenId.current !== null && newest.id > highestSeenId.current) {
          setLatestAlert(newest);
        }
        if (highestSeenId.current === null || newest.id > highestSeenId.current) {
          highestSeenId.current = newest.id;
        }
      }
    } catch {
      // retry silently on next interval
    }
  }, [filterType, filterCameraId, onlyUnack, onGlobalStatsUpdate]);

  useEffect(() => {
    fetchAll();
    const timer = setInterval(fetchAll, 2500);
    return () => clearInterval(timer);
  }, [fetchAll]);

  const handleAcknowledge = async (id: number) => {
    const updated = await api.acknowledgeViolation(id);
    setViolations((prev) => prev.map((v) => (v.id === id ? updated : v)));
    if (activeVideo && activeVideo.id === id) {
      setActiveVideo(updated);
    }
    fetchAll();
  };

  return (
    <div className="space-y-8">
      {latestAlert && (
        <div className="bg-red-950/80 border border-red-500/50 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-500/20 text-red-300">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">
                Новое срабатывание YOLOv8:{" "}
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

      <StatsOverview stats={stats} />

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Видеостена реального времени</h2>
            <p className="text-xs text-slate-400">
              Потоковый мониторинг камер школы с автоматической классификацией объектов и проверкой бесхозных сумок
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={fetchAll}
              className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 transition"
              title="Обновить данные"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-medium text-white transition shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Добавить камеру
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {cameras.map((cam) => (
            <CameraCard
              key={cam.id}
              camera={cam}
              onToggle={async (id) => {
                await api.toggleCamera(id);
                fetchAll();
              }}
              onDelete={async (id) => {
                await api.deleteCamera(id);
                fetchAll();
              }}
              onSimulate={async (id, scenario) => {
                await api.simulateEvent(id, scenario);
              }}
              onExpand={setExpandedCamera}
            />
          ))}
        </div>
      </section>

      <ViolationsTable
        violations={violations}
        cameras={cameras}
        filterType={filterType}
        filterCameraId={filterCameraId}
        onlyUnack={onlyUnack}
        onChangeType={setFilterType}
        onChangeCamera={setFilterCameraId}
        onChangeUnack={setOnlyUnack}
        onOpenVideo={setActiveVideo}
        onAcknowledge={handleAcknowledge}
        onDelete={async (id) => {
          await api.deleteViolation(id);
          fetchAll();
        }}
      />

      <AddCameraModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={async (payload) => {
          await api.addCamera(payload);
          await fetchAll();
        }}
      />

      <VideoModal
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
