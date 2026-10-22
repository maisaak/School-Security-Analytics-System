import React from "react";
import { BrainCircuit, Crosshair, FlaskConical, Hourglass, KeyRound, Maximize2, Pause, Play, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import { Camera, DetectorProfile } from "../api/client";
import { CameraStream } from "./CameraStream";

interface CameraCardProps {
  camera: Camera;
  canManage: boolean;
  canSimulate: boolean;
  dwellThreshold: number;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onSimulate: (
    id: number,
    scenario: "suspicious_bag" | "dog" | "weapon" | "person_with_bag"
  ) => void;
  onExpand: (camera: Camera) => void;
  detectorProfiles?: DetectorProfile[];
  onDetectorChange?: (id: number, profile: string) => void;
  onOpenPolicy?: (camera: Camera) => void;
}

export const CameraCard: React.FC<CameraCardProps> = ({
  camera,
  canManage,
  canSimulate,
  dwellThreshold,
  onToggle,
  onDelete,
  onSimulate,
  onExpand,
  detectorProfiles = [],
  onDetectorChange,
  onOpenPolicy,
}) => {
  const hasThreat = camera.active_threats.length > 0;
  const holding = camera.bag_tracking?.filter((t) => t.state === "holding") ?? [];
  const confirmed = camera.bag_tracking?.filter((t) => t.state === "unattended") ?? [];
  const tracked = holding[0];

  return (
    <div
      className={`panel rounded-2xl border overflow-hidden transition duration-200 ${
        hasThreat
          ? "border-red-500/80 ring-2 ring-red-500/25"
          : "border-slate-800 hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-xl hover:shadow-black/20"
      }`}
    >
      <div className="aspect-video bg-slate-950 relative group">
        <CameraStream camera={camera} />

        <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2 max-w-[80%]">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold backdrop-blur-md ${
              !camera.is_active
                ? "bg-slate-800/90 text-slate-300"
                : hasThreat
                ? "bg-red-600/95 text-white animate-pulse"
                : "bg-slate-950/85 text-emerald-400 border border-emerald-500/30"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                !camera.is_active ? "bg-slate-400" : hasThreat ? "bg-white" : "bg-emerald-400"
              }`}
            />
            {!camera.is_active
              ? "ПАУЗА"
              : hasThreat
              ? "ТРЕВОГА В КАДРЕ"
              : `LIVE · ${camera.fps > 0 ? camera.fps.toFixed(0) : "—"} FPS`}
          </span>

          {tracked && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold backdrop-blur-md bg-amber-500/90 text-black">
              <Hourglass className="w-3 h-3" />
              {tracked.track_id} · {tracked.dwell_seconds.toFixed(1)} / {dwellThreshold.toFixed(0)} с
            </span>
          )}
          {confirmed.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold backdrop-blur-md bg-red-600/90 text-white">
              БЕСХОЗНЫХ: {confirmed.length}
            </span>
          )}
        </div>

        <button
          onClick={() => onExpand(camera)}
          title="Развернуть поток на весь экран"
          className="absolute top-3 right-3 p-2 rounded-lg bg-slate-950/75 text-slate-200 opacity-0 group-hover:opacity-100 hover:bg-slate-900 transition"
        >
          <Maximize2 className="w-4 h-4" />
        </button>

        {tracked && (
          <div className="absolute bottom-3 left-3 right-3">
            <div className="h-1.5 rounded-full bg-slate-950/80 overflow-hidden border border-amber-500/30">
              <div
                className="h-full bg-amber-400 transition-all duration-500"
                style={{
                  width: `${Math.min(100, (tracked.dwell_seconds / Math.max(0.1, dwellThreshold)) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-1 text-[10px] text-amber-200/90 font-medium drop-shadow">
              Таймер выдержки бесхозного предмета — тревога после {dwellThreshold.toFixed(0)} с
            </p>
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-ink truncate">{camera.name}</h3>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">{camera.location}</p>
            <p className="text-[10px] text-slate-500 font-mono truncate mt-1 flex items-center gap-1">
              {camera.has_credentials && <KeyRound className="w-3 h-3 text-amber-500/80 shrink-0" />}
              {camera.rtsp_url}
            </p>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {camera.zones_count > 0 && (
                <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border text-brand-300 border-brand-500/30 bg-brand-500/10">
                  <Crosshair className="w-2.5 h-2.5" /> {camera.zones_count} зон
                </span>
              )}
              {camera.ab_profile && (
                <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border text-sky-300 border-sky-500/30 bg-sky-500/10">
                  <FlaskConical className="w-2.5 h-2.5" /> A/B {camera.ab_share_pct}%
                </span>
              )}
              <span
                className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                  camera.source_kind === "rtsp"
                    ? "text-sky-300 border-sky-500/30 bg-sky-500/10"
                    : camera.source_kind === "simulated"
                    ? "text-brand-300 border-brand-500/30 bg-brand-500/10"
                    : "text-slate-300 border-slate-600/40 bg-slate-700/20"
                }`}
              >
                {camera.source_kind === "rtsp" ? "RTSP" : camera.source_kind === "simulated" ? "SIM" : camera.source_kind.toUpperCase()}
              </span>
              <span
                className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                  camera.stream_mode === "hls"
                    ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                    : "text-slate-400 border-slate-600/40 bg-slate-700/20"
                }`}
              >
                {camera.stream_mode === "hls" ? "HLS" : "MJPEG"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10px] font-mono text-slate-500 mr-1">
              {camera.latency_ms > 0 ? `${camera.latency_ms.toFixed(0)} мс` : "—"}
            </span>
            {canManage && (
              <>
                <button
                  onClick={() => onOpenPolicy?.(camera)}
                  title="Зоны ROI, порог, расписание и A/B моделей"
                  className="p-2 rounded-lg text-slate-400 hover:text-brand-300 hover:bg-brand-500/10 transition"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onToggle(camera.id)}
                  title={camera.is_active ? "Приостановить поток" : "Возобновить поток"}
                  className="p-2 rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800 transition"
                >
                  {camera.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => onDelete(camera.id)}
                  title="Удалить камеру"
                  className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {canManage && detectorProfiles.length > 0 && (
          <div className="pt-2.5 border-t border-slate-800/80">
            <label className="flex items-center gap-1.5 text-[10px] text-slate-400 mb-1.5">
              <BrainCircuit className="w-3.5 h-3.5 text-emerald-400" />
              Модели YOLO на этой камере
            </label>
            <select
              value={camera.detector_profile}
              onChange={(e) => onDetectorChange?.(camera.id, e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-emerald-500/60"
            >
              {detectorProfiles.map((profile) => (
                <option key={profile.key} value={profile.key}>
                  {profile.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 mt-1 leading-snug">
              {detectorProfiles.find((p) => p.key === camera.detector_profile)?.description}
            </p>
          </div>
        )}

        {camera.is_simulated && camera.is_active && canSimulate && (
          <div className="pt-2.5 border-t border-slate-800/80">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-brand-400" />
              <span>Мгновенный тест детекции YOLOv8 в кадре:</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <button
                onClick={() => onSimulate(camera.id, "suspicious_bag")}
                className="px-2 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/25 text-[10px] font-medium transition"
              >
                Бесхозная сумка
              </button>
              <button
                onClick={() => onSimulate(camera.id, "dog")}
                className="px-2 py-1.5 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-300 border border-orange-500/25 text-[10px] font-medium transition"
              >
                Собака
              </button>
              <button
                onClick={() => onSimulate(camera.id, "weapon")}
                className="px-2 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/25 text-[10px] font-medium transition"
              >
                Оружие
              </button>
              <button
                onClick={() => onSimulate(camera.id, "person_with_bag")}
                title="Проверка отсутствия ложной тревоги, когда владелец идёт рядом с сумкой"
                className="px-2 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/25 text-[10px] font-medium transition"
              >
                Ученик с сумкой
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
