import React from "react";
import { CheckCircle2, Clock, Play, Trash2 } from "lucide-react";
import { Camera, Violation } from "../api/client";
import { CustomSelect } from "./CustomSelect";

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
  canAcknowledge: boolean;
  canDelete: boolean;
  violations: Violation[];
  cameras: Camera[];
  filterType: string;
  filterCameraId: number | undefined;
  onlyUnack: boolean;
  reviewStatus: string;
  onChangeType: (value: string) => void;
  onChangeCamera: (cameraId: number | undefined) => void;
  onChangeUnack: (value: boolean) => void;
  onChangeReviewStatus: (value: string) => void;
  onOpenVideo: (violation: Violation) => void;
  onAcknowledge: (id: number) => void;
  onReview: (id: number, status: Violation["review_status"], comment: string) => void;
  onDelete: (id: number) => void;
}

export const ViolationsTable: React.FC<ViolationsTableProps> = ({
  canAcknowledge,
  canDelete,
  violations,
  cameras,
  filterType,
  filterCameraId,
  onlyUnack,
  reviewStatus,
  onChangeType,
  onChangeCamera,
  onChangeUnack,
  onChangeReviewStatus,
  onOpenVideo,
  onAcknowledge,
  onReview,
  onDelete,
}) => {
  return (
    <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Журнал зафиксированных нарушений</h2>
          <p className="text-xs text-slate-400">
            Автоматическая фотофиксация и запись H.264 видеоклипа при каждом срабатывании YOLOv8
          </p>
        </div>

        <div className="journal-filters">
          <CustomSelect ariaLabel="Тип угрозы" value={filterType} onChange={onChangeType} options={[
            { value: "", label: "Все типы угроз" }, { value: "weapon", label: "Оружие" },
            { value: "suspicious_bag", label: "Бесхозные сумки" }, { value: "dog", label: "Собаки на территории" },
          ]} />
          <CustomSelect ariaLabel="Камера" value={String(filterCameraId ?? "")} onChange={value => onChangeCamera(value ? Number(value) : undefined)} options={[
            { value: "", label: "Все камеры" }, ...cameras.map(cam => ({ value: String(cam.id), label: cam.name })),
          ]} />
          <label className={`journal-filter-check ${onlyUnack ? "is-active" : ""}`}>
            <input
              type="checkbox"
              checked={onlyUnack}
              onChange={(e) => onChangeUnack(e.target.checked)}
              className="custom-checkbox"
            />
            Неподтверждённые
          </label>
          <CustomSelect ariaLabel="Статус инцидента" value={reviewStatus} onChange={onChangeReviewStatus} options={[
            { value: "", label: "Все статусы" }, { value: "new", label: "Новые" },
            { value: "in_review", label: "На проверке" }, { value: "confirmed", label: "Подтверждённые" },
            { value: "false_alarm", label: "Ложные тревоги" }, { value: "closed", label: "Закрытые" },
          ]} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
            <tr>
              <th className="py-3 px-2.5">Кадр фиксации</th>
              <th className="py-3 px-2.5">Класс угрозы</th>
              <th className="py-3 px-2.5">Камера / Зона</th>
              <th className="py-3 px-2.5">Уверенность</th>
              <th className="py-3 px-2.5">Время события</th>
              <th className="py-3 px-2.5">Статус</th>
              <th className="py-3 px-2.5 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {violations.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400 text-sm">
                  По выбранным фильтрам инцидентов пока не зафиксировано. Нажмите кнопку сценария под любой камерой для мгновенного теста.
                </td>
              </tr>
            ) : (
              violations.map((v) => {
                const meta = VIOLATION_META[v.violation_type] ?? VIOLATION_META.suspicious_bag;
                return (
                  <tr key={v.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-2.5">
                      <button
                        onClick={() => onOpenVideo(v)}
                        className="relative group block rounded-lg overflow-hidden border border-slate-700 w-28 h-16 bg-black"
                      >
                        <img
                          src={v.image_path}
                          alt={meta.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition"
                        />
                        <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                          <Play className="w-5 h-5 text-white fill-white" />
                        </span>
                      </button>
                    </td>
                    <td className="py-3 px-2.5">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${meta.badgeClass}`}
                      >
                        {meta.title}
                      </span>
                    </td>
                    <td className="py-3 px-2.5">
                      <div className="font-medium text-white text-xs sm:text-sm">{v.camera_name}</div>
                      <div className="text-xs text-slate-400">{v.camera_location}</div>
                    </td>
                    <td className="py-3 px-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-indigo-500"
                            style={{ width: `${Math.min(100, v.confidence * 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs text-slate-200">
                          {(v.confidence * 100).toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-2.5 text-xs text-slate-300 font-mono whitespace-nowrap">
                      {new Date(v.detected_at).toLocaleString("ru-RU")}
                    </td>
                    <td className="py-3 px-2.5">
                      <select
                        value={v.review_status}
                        disabled={!canAcknowledge}
                        onChange={(event) => {
                          const status = event.target.value as Violation["review_status"];
                          const comment = window.prompt("Комментарий к решению (необязательно):", v.review_comment) ?? v.review_comment;
                          onReview(v.id, status, comment);
                        }}
                        aria-label={`Статус инцидента ${v.id}`}
                        className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200"
                      >
                        <option value="new">Новое</option>
                        <option value="in_review">На проверке</option>
                        <option value="confirmed">Подтверждено</option>
                        <option value="false_alarm">Ложная тревога</option>
                        <option value="closed">Закрыто</option>
                      </select>
                      <button
                        onClick={() => onAcknowledge(v.id)}
                        disabled={!canAcknowledge || v.is_acknowledged}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                          v.is_acknowledged
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                            : "bg-slate-800 text-amber-300 hover:bg-slate-700 border border-slate-700"
                        }`}
                      >
                        {v.is_acknowledged ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Отработано
                          </>
                        ) : (
                          <>
                            <Clock className="w-3.5 h-3.5" />
                            Подтвердить
                          </>
                        )}
                      </button>
                    </td>
                    <td className="py-3 px-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => onOpenVideo(v)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition"
                        >
                          <Play className="w-3.5 h-3.5" />
                          {v.video_url ? "Видео" : "Фото"}
                        </button>
                        {canDelete && <button
                          onClick={() => onDelete(v.id)}
                          title="Удалить запись"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>}
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
