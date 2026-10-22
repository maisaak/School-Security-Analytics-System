import React from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  BrainCircuit,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Hourglass,
  ImageDown,
  Play,
  ScanEye,
  Trash2,
} from "lucide-react";
import { api, Camera, Violation } from "../api/client";
import { usePrefs } from "../prefs/PrefsContext";
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

export interface ViolationFilters {
  type: string;
  cameraId?: number;
  onlyUnack: boolean;
  dateFrom: string;
  dateTo: string;
  falseAlarmOnly: boolean;
  sort: string;
}

interface ViolationsTableProps {
  violations: Violation[];
  cameras: Camera[];
  filters: ViolationFilters;
  page: number;
  pageSize: number;
  total: number;
  canAck: boolean;
  canDelete: boolean;
  canTrain: boolean;
  onChangeType: (value: string) => void;
  onChangeCamera: (cameraId: number | undefined) => void;
  onChangeUnack: (value: boolean) => void;
  onChangeFilters: (patch: Partial<ViolationFilters>) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onOpenVideo: (violation: Violation) => void;
  onAcknowledge: (id: number) => void;
  onDelete: (id: number) => void;
  onToggleFalseAlarm: (violation: Violation) => void;
  onAddToDataset: (violation: Violation) => void;
}

export const ViolationsTable: React.FC<ViolationsTableProps> = ({
  violations,
  cameras,
  filters,
  page,
  pageSize,
  total,
  canAck,
  canDelete,
  canTrain,
  onChangeType,
  onChangeCamera,
  onChangeUnack,
  onChangeFilters,
  onPageChange,
  onPageSizeChange,
  onOpenVideo,
  onAcknowledge,
  onDelete,
  onToggleFalseAlarm,
  onAddToDataset,
}) => {
  const { prefs } = usePrefs();
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const exportParams = {
    violation_type: filters.type || undefined,
    camera_id: filters.cameraId,
    unacknowledged_only: filters.onlyUnack,
    false_alarm: filters.falseAlarmOnly ? true : undefined,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
  };
  const reportParams = {
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
    camera_id: filters.cameraId,
    violation_type: filters.type || undefined,
  };

  return (
    <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm sm:text-base font-semibold text-ink">Журнал зафиксированных нарушений</h2>
          <p className="text-[11px] text-slate-400">
            Серверная пагинация и сортировка · записей за период: <span className="text-slate-200">{total}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <a
            href={api.violationsExportUrl({ ...exportParams, limit: 20000 })}
            download
            title="CSV для Excel: «;», UTF-8 BOM, фильтры и период учитываются"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-[11px] font-medium text-white transition"
          >
            <Download className="w-3.5 h-3.5" /> Экспорт CSV
          </a>
          <a
            href={api.reportUrl("pdf", reportParams)}
            title="PDF-отчёт с водяным знаком и сводкой SLA"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200 transition"
          >
            <FileText className="w-3.5 h-3.5" /> PDF
          </a>
          <a
            href={api.reportUrl("xlsx", reportParams)}
            title="Excel-отчёт: сводка, инциденты, топ камер"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200 transition"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-slate-500">Тип</span>
          <select
            value={filters.type}
            onChange={(e) => onChangeType(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-brand-500"
          >
            <option value="">Все типы угроз</option>
            <option value="weapon">Оружие</option>
            <option value="suspicious_bag">Бесхозные сумки</option>
            <option value="dog">Собаки на территории</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-slate-500">Камера</span>
          <select
            value={filters.cameraId ?? ""}
            onChange={(e) => onChangeCamera(e.target.value ? Number(e.target.value) : undefined)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-brand-500 max-w-[190px]"
          >
            <option value="">Все камеры</option>
            {cameras.map((cam) => (
              <option key={cam.id} value={cam.id}>
                {cam.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-slate-500">С даты</span>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => {
              onChangeFilters({ dateFrom: e.target.value });
              onPageChange(0);
            }}
            className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-brand-500"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-slate-500">По дату</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => {
              onChangeFilters({ dateTo: e.target.value });
              onPageChange(0);
            }}
            className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-brand-500"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1">
            <ArrowUpDown className="w-3 h-3" /> Сортировка
          </span>
          <select
            value={filters.sort}
            onChange={(e) => {
              onChangeFilters({ sort: e.target.value });
              onPageChange(0);
            }}
            className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-brand-500"
          >
            <option value="-detected_at">Сначала новые</option>
            <option value="detected_at">Сначала старые</option>
            <option value="-confidence">Уверенность ↓</option>
            <option value="confidence">Уверенность ↑</option>
            <option value="-acknowledged_latency_sec">Реакция ↓</option>
          </select>
        </label>

        <label className="inline-flex items-center gap-2 px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 cursor-pointer select-none self-end">
          <input
            type="checkbox"
            checked={filters.onlyUnack}
            onChange={(e) => {
              onChangeUnack(e.target.checked);
              onPageChange(0);
            }}
            className="rounded accent-brand-500"
          />
          Неподтверждённые
        </label>

        <label className="inline-flex items-center gap-2 px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 cursor-pointer select-none self-end">
          <input
            type="checkbox"
            checked={filters.falseAlarmOnly}
            onChange={(e) => {
              onChangeFilters({ falseAlarmOnly: e.target.checked });
              onPageChange(0);
            }}
            className="rounded accent-amber-500"
          />
          Только ложные
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className={`w-full text-sm text-left ${prefs.compact_tables ? "compact-table" : ""}`}>
          <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
            <tr>
              <th className="py-3 px-2">Кадр</th>
              <th className="py-3 px-2">Класс угрозы</th>
              <th className="py-3 px-2">Камера / Зона</th>
              <th className="py-3 px-2">Уверенность</th>
              <th className="py-3 px-2">Трекинг / реакция</th>
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
                        className="compact-thumb relative group block rounded-lg overflow-hidden border border-slate-700 w-24 h-14 bg-black shrink-0"
                      >
                        <img
                          src={api.mediaUrl(v.image_path)}
                          alt={meta.title}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition"
                        />
                        <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                          <Play className="w-4 h-4 text-ink fill-white" />
                        </span>
                        {v.is_false_alarm && (
                          <span className="absolute top-0.5 left-0.5 px-1 py-0.5 rounded bg-amber-500/90 text-[8px] font-bold text-slate-950">
                            ЛОЖНОЕ
                          </span>
                        )}
                      </button>
                    </td>
                    <td className="py-3 px-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${meta.badgeClass}`}
                      >
                        {meta.title}
                      </span>
                      {v.model_variant && v.model_variant !== "A" && (
                        <span className="ml-1 text-[9px] font-mono text-sky-300">A/B:{v.model_variant}</span>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      <div className="font-medium text-ink text-[11px] sm:text-xs">{v.camera_name}</div>
                      <div className="text-[10px] text-slate-400">
                        {v.zone_name ? `зона: ${v.zone_name}` : v.camera_location}
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-brand-500"
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
                      ) : v.acknowledged_latency_sec !== null ? (
                        <span className="text-[10px] text-emerald-300">
                          реакция {v.acknowledged_latency_sec.toFixed(0)} с
                        </span>
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
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => onOpenVideo(v)}
                          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-[10px] font-medium transition"
                          title="Открыть фото и видео"
                        >
                          <Play className="w-3 h-3" /> Видео
                        </button>
                        <a
                          href={api.violationSnapshotUrl(v.id, { watermark: true, blurFaces: false, download: true })}
                          title="Скачать кадр с водяным знаком (кто и когда выгрузил)"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-sky-500/10 transition"
                        >
                          <ImageDown className="w-3.5 h-3.5" />
                        </a>
                        {canAck && (
                          <button
                            onClick={() => onToggleFalseAlarm(v)}
                            title={v.is_false_alarm ? "Снять отметку «ложное срабатывание»" : "Отметить как ложное срабатывание"}
                            className={`p-1.5 rounded-lg transition ${
                              v.is_false_alarm
                                ? "text-amber-300 bg-amber-500/15"
                                : "text-slate-400 hover:text-amber-300 hover:bg-amber-500/10"
                            }`}
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canTrain && (
                          <button
                            onClick={() => onAddToDataset(v)}
                            title="Добавить кадр в датасет дообучения (активное обучение)"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-sky-500/10 transition"
                          >
                            <BrainCircuit className="w-3.5 h-3.5" />
                          </button>
                        )}
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

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span>
            Показано {from}–{to} из {total}
          </span>
          <select
            value={pageSize}
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value));
              onPageChange(0);
            }}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-300"
          >
            <option value={10}>10 / стр.</option>
            <option value={25}>25 / стр.</option>
            <option value={50}>50 / стр.</option>
            <option value={100}>100 / стр.</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onPageChange(Math.max(0, page - 1))}
            disabled={page <= 0}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 text-[11px] text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Назад
          </button>
          <span className="text-[11px] text-slate-400 font-mono px-1">
            {page + 1} / {pages}
          </span>
          <button
            onClick={() => onPageChange(Math.min(pages - 1, page + 1))}
            disabled={page + 1 >= pages}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 text-[11px] text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Вперёд <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </section>
  );
};
