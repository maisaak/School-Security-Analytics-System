import React from "react";
import { Maximize2, Pause, Play, Sparkles, Trash2 } from "lucide-react";
import { Camera } from "../api/client";

interface CameraCardProps {
  camera: Camera;
  canManage: boolean;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onSimulate: (
    id: number,
    scenario: "suspicious_bag" | "dog" | "weapon" | "person_with_bag"
  ) => void;
  onExpand: (camera: Camera) => void;
}

export const CameraCard: React.FC<CameraCardProps> = ({
  camera,
  canManage,
  onToggle,
  onDelete,
  onSimulate,
  onExpand,
}) => {
  const hasThreat = camera.active_threats && camera.active_threats.length > 0;

  return (
    <div
      className={`bg-slate-900 rounded-2xl border overflow-hidden transition ${
        hasThreat
          ? "border-red-500/80 ring-2 ring-red-500/25"
          : "border-slate-800 hover:border-slate-700"
      }`}
    >
      <div className="aspect-video bg-slate-950 relative group">
        {camera.is_active ? (
          <img
            src={`/api/cameras/${camera.id}/stream`}
            alt={camera.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-2">
            <Pause className="w-8 h-8 opacity-60" />
            <span className="text-xs font-medium">Поток приостановлен оператором</span>
          </div>
        )}

        <div className="absolute top-3 left-3 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold backdrop-blur-md ${
              !camera.is_active
                ? "bg-slate-800/90 text-slate-300"
                : !camera.online
                ? "bg-slate-800/90 text-amber-300"
                : hasThreat
                ? "bg-red-600/95 text-white animate-pulse"
                : "bg-slate-950/85 text-emerald-400 border border-emerald-500/30"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                !camera.is_active
                  ? "bg-slate-400"
                  : !camera.online
                  ? "bg-amber-400"
                  : hasThreat
                  ? "bg-white"
                  : "bg-emerald-400"
              }`}
            />
            {!camera.is_active
              ? "ПАУЗА"
              : !camera.online
              ? "НЕТ СВЯЗИ"
              : hasThreat
              ? "ТРЕВОГА В КАДРЕ"
              : `LIVE · ${camera.fps.toFixed(0)} FPS`}
          </span>
        </div>

        <button
          onClick={() => onExpand(camera)}
          title="Развернуть поток на весь экран"
          className="absolute top-3 right-3 p-2 rounded-lg bg-slate-950/75 text-slate-200 opacity-0 group-hover:opacity-100 hover:bg-slate-900 transition"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-3">
        {camera.last_error && <p className="text-xs text-red-300">{camera.last_error}</p>}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-white truncate">{camera.name}</h3>
            <p className="text-xs text-slate-400 truncate mt-0.5">
              {camera.location} · <span className="font-mono text-slate-500">{camera.rtsp_url}</span>
            </p>
          </div>

          {canManage && <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onToggle(camera.id)}
              title={camera.is_active ? "Приостановить поток" : "Возобновить поток"}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
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
          </div>}
        </div>

        {canManage && camera.is_simulated && camera.is_active && (
          <div className="pt-2.5 border-t border-slate-800/80">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Мгновенный тест детекции YOLOv8 в кадре:</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <button
                onClick={() => onSimulate(camera.id, "suspicious_bag")}
                className="px-2 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/25 text-[11px] font-medium transition"
              >
                Бесхозная сумка
              </button>
              <button
                onClick={() => onSimulate(camera.id, "dog")}
                className="px-2 py-1.5 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-300 border border-orange-500/25 text-[11px] font-medium transition"
              >
                Собака
              </button>
              <button
                onClick={() => onSimulate(camera.id, "weapon")}
                className="px-2 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/25 text-[11px] font-medium transition"
              >
                Оружие
              </button>
              <button
                onClick={() => onSimulate(camera.id, "person_with_bag")}
                title="Проверка отсутствия ложной тревоги, когда владелец идёт рядом с сумкой"
                className="px-2 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/25 text-[11px] font-medium transition"
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
