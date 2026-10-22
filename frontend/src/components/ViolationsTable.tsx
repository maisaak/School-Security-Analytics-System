import React from "react";
import { CheckCircle2, Clock, Hourglass, Play, ScanEye, Trash2 } from "lucide-react";
import { Camera, Violation } from "../api/client";
import { formatDateTime } from "./ui";

export const VIOLATION_META: Record<
  Violation["violation_type"],
  { title: string; badgeClass: string }
> = {
  weapon: {
    title: "Оружие",
    badgeClass: "bg-red-500/15 text-red-300 border-red-500/40",
  },
  suspicious_bag: {
    title: "Бесхозная сумка",
    badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  },
  dog: {
    title: "Собака на территории",
    badgeClass: "bg-orange-500/15 text-orange-300 border-orange-500/40",
  },
};

interface ViolationsTableProps {
  violations: Violation[];
  cameras: Camera[];
  filterType: string;
  filterCameraId: number | undefined;
  onlyUnack: boolean;
  canAck: boolean;
  canDelete: boolean;
  onChangeType: (value: string) => void;
  onChangeCamera: (cameraId: number | undefined) => void;
  onChangeUnack: (value: boolean) => void;
  onOpenVideo: (violation: Violation) => void;
  onAcknowledge: (id: number) => void;
  onDelete: (id: number) => void;
}

export const ViolationsTable: React.FC<ViolationsTableProps> = ({
  violations,
  cameras,
  filterType,
  filterCameraId,
  onlyUnack,
  canAck,
  canDelete,
  onChangeType,
  onChangeCamera,
  onChangeUnack,
  onOpenVideo,
  onAcknowledge,
  onDelete,
}) => {
  return (
    <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm sm:text-base font-semibold text-white">Журнал зафиксированных нарушений</h2>
          <p className="text-[11px] text-slate-400">
            Фотофиксация, H.264-клип и данные трекинга по каждому срабатыванию YOLOv8
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filterType}
            onChange={(e) => onChangeType(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Все типы угроз</option>
            <option value="weapon">Оружие</option>
            <option value="suspicious_bag">Бесхозные сумки</option>
            <option value="dog">Собаки на территории</option>
          </select>

          <select
            value={filterCameraId ?? ""}
            onChange={(e) => onChangeCamera(e.target.value ? Number(e.target.value) : undefined)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500 max-w-[190px]"
          >
            <option value="">Все камеры</option>
            {cameras.map((cam) => (
              <option key={cam.id} value={cam.id}>
                {cam.name}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyUnack}
              onChange={(e) => onChangeUnack(e.target.checked)}
              className="rounded accent-indigo-500"
            />
            Неподтверждённые
          </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
            <tr>
              <th className="py-3 px-2">Кадр</th>
              <th className="py-3 px-2">Класс угрозы</th>
              <th className="py-3 px-2">Камера / Зона</th>
              <th className="py-3 px-2">Уверенность</th>
              <th className="py-3 px-2">Трекинг</th>
              <th className="py-3 px-2">Время</th>
              <th className="py-3 px-2">Статус</th>
              <th className="py-3 px-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {violations.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400 text-xs">
                  По выбранным фильтрам инцидентов пока не зафиксировано.
                </td>
              </tr>
            ) : (
              violations.map((v) => {
                const meta = VIOLATION_META[v.violation_type] ?? VIOLATION_META.suspicious_bag;
                return (
                  <tr key={v.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-2">
                      <button
                        onClick={() => onOpenVideo(v)}
                        className="relative group block rounded-lg overflow-hidden border border-slate-700 w-24 h-14 bg-black shrink-0"
                      >
                        <img
                          src={v.image_path}
                          alt={meta.title}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition"
                        />
                        <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                          <Play className="w-4 h-4 text-white fill-white" />
                        </span>
                      </button>
                    </td>
                    <td className="py-3 px-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${meta.badgeClass}`}
                      >
                        {meta.title}
                      </span>
                    </td>
                    <td className="py-3 px-2">
                      <div className="font-medium text-white text-[11px] sm:text-xs">{v.camera_name}</div>
                      <div className="text-[10px] text-slate-400">{v.camera_location}</div>
                    </td>
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-indigo-500"
                            style={{ width: `${Math.min(100, v.confidence * 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-[10px] text-slate-200">
                          {(v.confidence * 100).toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      {v.track_id ? (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-sky-300">
                            <ScanEye className="w-3 h-3" />
                            {v.track_id}
                          </span>
                          {v.dwell_seconds !== null && (
                            <div className="flex items-center gap-1 text-[10px] text-amber-300">
                              <Hourglass className="w-3 h-3" />
                              выдержка {v.dwell_seconds.toFixed(1)} с
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-[10px] text-slate-300 font-mono whitespace-nowrap">
                      {formatDateTime(v.detected_at)}
                    </td>
                    <td className="py-3 px-2">
                      {canAck ? (
                        <button
                          onClick={() => onAcknowledge(v.id)}
                          title={
                            v.is_acknowledged && v.acknowledged_by
                              ? `Подтвердил: ${v.acknowledged_by}`
                              : "Подтвердить отработку"
                          }
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition ${
                            v.is_acknowledged
                              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                              : "bg-slate-800 text-amber-300 hover:bg-slate-700 border border-slate-700"
                          }`}
                        >
                          {v.is_acknowledged ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              Отработано
                            </>
                          ) : (
                            <>
                              <Clock className="w-3 h-3" />
                              Подтвердить
                            </>
                          )}
                        </button>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${
                            v.is_acknowledged
                              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                              : "bg-amber-500/10 text-amber-300 border-amber-500/30"
                          }`}
                        >
                          {v.is_acknowledged ? "Отработано" : "Ожидает"}
                        </span>
                      )}
                      {v.is_acknowledged && v.acknowledged_by && (
                        <p className="text-[9px] text-slate-500 mt-1">@{v.acknowledged_by}</p>
                      )}
                    </td>
                    <td className="py-3 px-2 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => onOpenVideo(v)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-medium transition"
                        >
                          <Play className="w-3 h-3" />
                          Видео
                        </button>
                        {canDelete && (
                          <button
                            onClick={() => onDelete(v.id)}
                            title="Удалить улику"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
