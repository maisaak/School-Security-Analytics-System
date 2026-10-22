import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, RefreshCw, X } from "lucide-react";
import { api, Camera, DashboardStats, DetectorProfile, Violation } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { StatsOverview } from "../components/StatsOverview";
import { CameraCard } from "../components/CameraCard";
import { AddCameraModal } from "../components/AddCameraModal";
import { CameraStream } from "../components/CameraStream";
import { VIOLATION_META, ViolationFilters, ViolationsTable } from "../components/ViolationsTable";
import { CameraPolicyModal } from "../components/CameraPolicyModal";
import { VideoModal } from "../components/VideoModal";
import { ErrorNotice } from "../components/ui";

interface DashboardPageProps {
  onGlobalStatsUpdate: (stats: DashboardStats) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onGlobalStatsUpdate }) => {
  const { can } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<ViolationFilters>({
    type: "",
    cameraId: undefined,
    onlyUnack: false,
    dateFrom: "",
    dateTo: "",
    falseAlarmOnly: false,
    sort: "-detected_at",
  });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [policyCamera, setPolicyCamera] = useState<Camera | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedCamera, setExpandedCamera] = useState<Camera | null>(null);
  const [detectorProfiles, setDetectorProfiles] = useState<DetectorProfile[]>([]);
  const [activeVideo, setActiveVideo] = useState<Violation | null>(null);
  const [latestAlert, setLatestAlert] = useState<Violation | null>(null);
  const highestSeenId = useRef<number | null>(null);

  const canSimulate = can("cameras:simulate");
  const canManageCameras = can("cameras:manage");

  useEffect(() => {
    if (!canManageCameras) {
      setDetectorProfiles([]);
      return;
    }
    api
      .getDetectorProfiles()
      .then((res) => setDetectorProfiles(res.profiles))
      .catch(() => setDetectorProfiles([]));
  }, [canManageCameras]);

  const fetchAll = useCallback(async () => {
    try {
      const [st, cams, pageData] = await Promise.all([
        api.getStats(),
        api.getCameras(),
        api.getViolationsPage({
          violation_type: filters.type || undefined,
          camera_id: filters.cameraId,
          unacknowledged_only: filters.onlyUnack,
          false_alarm: filters.falseAlarmOnly ? true : undefined,
          date_from: filters.dateFrom || undefined,
          date_to: filters.dateTo || undefined,
          sort: filters.sort,
          limit: pageSize,
          offset: page * pageSize,
        }),
      ]);
      setStats(st);
      onGlobalStatsUpdate(st);
      setCameras(cams);
      setViolations(pageData.items);
      setTotal(pageData.total);
      setError(null);

      if (pageData.items.length > 0) {
        const newest = pageData.items[0];
        if (highestSeenId.current !== null && newest.id > highestSeenId.current) {
          setLatestAlert(newest);
        }
        if (highestSeenId.current === null || newest.id > highestSeenId.current) {
          highestSeenId.current = newest.id;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить данные мониторинга");
    }
  }, [filters, page, pageSize, onGlobalStatsUpdate]);

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

  const handleToggleFalseAlarm = async (violation: Violation) => {
    try {
      await api.setFalseAlarm(violation.id, !violation.is_false_alarm);
      setNotice(
        violation.is_false_alarm
          ? `Инцидент #${violation.id} снова считается реальной тревогой`
          : `Инцидент #${violation.id} помечен как ложное срабатывание — учтён в отчёте по качеству`
      );
      fetchAll();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Не удалось обновить разметку");
    }
  };

  const handleAddToDataset = async (violation: Violation) => {
    try {
      const result = await api.addViolationToDataset(violation.id);
      setNotice(`Кадр #${violation.id} добавлен в датасет: ${result.filename}`);
      fetchAll();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Не удалось добавить кадр в датасет");
    }
  };

  const patchFilters = (patch: Partial<ViolationFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(0);
  };

  return (
    <div className="space-y-6">
      {latestAlert && (
        <div className="tinted-red bg-red-950/80 border border-red-500/50 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-500/20 text-red-300">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs sm:text-sm font-semibold text-ink">
                Новое срабатывание YOLOv8:{" "}
                {VIOLATION_META[latestAlert.violation_type]?.title ?? latestAlert.violation_type}
              </p>
              <p className="text-[11px] text-red-200/80">
                {latestAlert.camera_name} ({latestAlert.camera_location}) · уверенность{" "}
                {(latestAlert.confidence * 100).toFixed(1)}%
                {latestAlert.track_id ? ` · трек ${latestAlert.track_id}` : ""}
                {latestAlert.dwell_seconds !== null
                  ? ` · выдержка ${latestAlert.dwell_seconds.toFixed(1)} с`
                  : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setActiveVideo(latestAlert);
                setLatestAlert(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-[11px] font-semibold text-white transition"
            >
              Открыть видеозапись
            </button>
            <button
              onClick={() => setLatestAlert(null)}
              className="p-2 rounded-lg text-red-300 hover:text-ink"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {error && <ErrorNotice message={error} onRetry={fetchAll} />}

      {notice && (
        <div className="rounded-xl border border-brand-500/40 bg-brand-500/10 px-3 py-2 flex items-start justify-between gap-2">
          <p className="text-[11px] text-brand-200 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> {notice}
          </p>
          <button onClick={() => setNotice(null)} className="text-brand-300 hover:text-ink">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <StatsOverview stats={stats} />

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-ink">Видеостена реального времени</h2>
            <p className="text-[11px] text-slate-400">
              RTSP → HLS (H.264) с детекцией поверх кадра · MJPEG-фолбэк · трекинг бесхозных предметов с таймером выдержки
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchAll}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 transition"
              title="Обновить данные"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {can("cameras:manage") && (
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white transition shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Добавить камеру
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cameras.map((cam) => (
            <CameraCard
              key={cam.id}
              camera={cam}
              canManage={canManageCameras}
              canSimulate={canSimulate}
              detectorProfiles={detectorProfiles}
              onDetectorChange={async (id, profile) => {
                await api.setCameraDetector(id, profile);
                fetchAll();
              }}
              dwellThreshold={stats?.tracking.dwell_threshold_sec ?? 6}
              onToggle={async (id) => {
                await api.toggleCamera(id);
                fetchAll();
              }}
              onDelete={async (id) => {
                if (!window.confirm("Удалить камеру и все её улики?")) return;
                await api.deleteCamera(id);
                fetchAll();
              }}
              onSimulate={async (id, scenario) => {
                await api.simulateEvent(id, scenario);
              }}
              onExpand={setExpandedCamera}
              onOpenPolicy={setPolicyCamera}
            />
          ))}
        </div>
      </section>

      <ViolationsTable
        violations={violations}
        cameras={cameras}
        filters={filters}
        page={page}
        pageSize={pageSize}
        total={total}
        canAck={can("violations:ack")}
        canDelete={can("violations:delete")}
        canTrain={can("violations:train")}
        onChangeType={(value) => patchFilters({ type: value })}
        onChangeCamera={(cameraId) => patchFilters({ cameraId })}
        onChangeUnack={(value) => patchFilters({ onlyUnack: value })}
        onChangeFilters={patchFilters}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onOpenVideo={setActiveVideo}
        onAcknowledge={handleAcknowledge}
        onDelete={async (id) => {
          if (!window.confirm("Удалить запись и медиафайлы без возможности восстановления?")) return;
          await api.deleteViolation(id);
          fetchAll();
        }}
        onToggleFalseAlarm={handleToggleFalseAlarm}
        onAddToDataset={handleAddToDataset}
      />

      {policyCamera && (
        <CameraPolicyModal
          camera={policyCamera}
          profiles={detectorProfiles}
          onClose={() => setPolicyCamera(null)}
          onSaved={fetchAll}
        />
      )}

      {can("cameras:manage") && (
        <AddCameraModal
          open={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSubmit={async (payload) => {
            await api.addCamera(payload);
            await fetchAll();
          }}
        />
      )}

      <VideoModal
        violation={activeVideo}
        canAck={can("violations:ack")}
        onClose={() => setActiveVideo(null)}
        onAcknowledge={handleAcknowledge}
      />

      {expandedCamera && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-5xl w-full p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-ink text-sm">{expandedCamera.name}</h3>
                <p className="text-[11px] text-slate-400">{expandedCamera.location}</p>
              </div>
              <button
                onClick={() => setExpandedCamera(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="w-full rounded-xl bg-black aspect-video overflow-hidden">
              <CameraStream
                camera={expandedCamera}
                showSwitch={false}
                className="w-full h-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
