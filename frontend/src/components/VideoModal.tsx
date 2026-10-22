import React from "react";
import { CheckCircle2, Download, Hourglass, ScanEye, ShieldAlert, Timer, X } from "lucide-react";
import { api, Violation } from "../api/client";
import { VIOLATION_META } from "./ViolationsTable";
import { formatDateTime } from "./ui";

interface VideoModalProps {
  violation: Violation | null;
  canAck: boolean;
  onClose: () => void;
  onAcknowledge: (id: number) => void;
}

export const VideoModal: React.FC<VideoModalProps> = ({
  violation,
  canAck,
  onClose,
  onAcknowledge,
}) => {
  if (!violation) return null;
  const meta = VIOLATION_META[violation.violation_type] ?? VIOLATION_META.suspicious_bag;
  const downloadUrl = api.videoDownloadUrl(violation);
  const snapshotUrl = api.violationSnapshotUrl(violation.id, { watermark: true, download: true });
  const blurredUrl = api.violationSnapshotUrl(violation.id, { watermark: true, blurFaces: true, download: true });

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full p-4 sm:p-6 space-y-4 shadow-2xl max-h-[96vh] overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${meta.badgeClass}`}>
              {meta.title}
            </span>
            <div className="min-w-0">
              <h3 className="font-semibold text-ink text-sm truncate">
                Инцидент #{violation.id} · {violation.camera_name}
              </h3>
              <p className="text-[11px] text-slate-400 truncate">
                {violation.camera_location} · уверенность {(violation.confidence * 100).toFixed(1)}% ·{" "}
                {formatDateTime(violation.detected_at)}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {violation.track_id && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-200">
            <ScanEye className="w-3.5 h-3.5" />
            Трек <span className="font-mono">{violation.track_id}</span>
            {violation.dwell_seconds !== null && (
              <>
                <span className="text-sky-500/60">·</span>
                <Hourglass className="w-3.5 h-3.5" />
                выдержка без владельца{" "}
                <span className="font-mono">{violation.dwell_seconds.toFixed(1)} с</span>
              </>
            )}
            <span className="text-sky-500/60">·</span>
            <span>тревога подтверждена трекером ByteTrack</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2 bg-black rounded-xl overflow-hidden border border-slate-800">
            <video
              key={violation.video_url}
              src={api.mediaUrl(violation.video_url)}
              controls
              autoPlay
              loop
              playsInline
              className="w-full aspect-video object-contain bg-black"
            />
          </div>

          <div className="space-y-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
            <p className="text-[11px] font-medium text-slate-400">Стоп-кадр срабатывания YOLOv8</p>
            <a href={snapshotUrl} title="Скачать кадр с водяным знаком">
              <img
                src={api.mediaUrl(violation.image_path)}
                alt={meta.title}
                className="w-full rounded-lg border border-slate-800 object-cover hover:opacity-90 transition"
              />
            </a>
            <div className="flex flex-wrap gap-1 text-[9.5px]">
              {violation.is_false_alarm && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  ложное срабатывание
                </span>
              )}
              {violation.zone_name && (
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                  зона: {violation.zone_name}
                </span>
              )}
              {violation.model_variant && violation.model_variant !== "A" && (
                <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                  A/B · вариант {violation.model_variant}
                </span>
              )}
              {violation.acknowledged_latency_sec !== null && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1">
                  <Timer className="w-2.5 h-2.5" /> реакция {violation.acknowledged_latency_sec.toFixed(0)} с
                </span>
              )}
            </div>
            <div className="pt-2 space-y-2">
              {canAck && (
                <button
                  onClick={() => onAcknowledge(violation.id)}
                  className={`w-full py-2 px-3 rounded-xl text-[11px] font-medium text-ink flex items-center justify-center gap-2 transition ${
                    violation.is_acknowledged
                      ? "bg-slate-700 hover:bg-slate-600"
                      : "bg-emerald-600 hover:bg-emerald-500"
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {violation.is_acknowledged ? "Снять отметку проверки" : "Отметить как отработанный"}
                </button>
              )}
              <a
                href={downloadUrl}
                className="w-full py-2 px-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-[11px] font-medium text-slate-200 flex items-center justify-center gap-2 transition"
              >
                <Download className="w-4 h-4" />
                Скачать H.264 MP4
              </a>
              <div className="grid grid-cols-2 gap-1.5">
                <a
                  href={snapshotUrl}
                  className="py-2 px-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-[10px] font-medium text-slate-200 flex items-center justify-center gap-1.5 text-center"
                  title="Кадр с водяным знаком: кто и когда выгрузил"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" /> Кадр
                </a>
                <a
                  href={blurredUrl}
                  className="py-2 px-2 rounded-xl border border-sky-500/30 bg-sky-500/5 hover:bg-sky-500/10 text-[10px] font-medium text-sky-200 flex items-center justify-center gap-1.5 text-center"
                  title="Кадр с размытием лиц — для передачи третьим лицам (152-ФЗ)"
                >
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> Без лиц
                </a>
              </div>
              <p className="text-[9px] text-slate-500 text-center leading-snug">
                Выгрузка фиксируется в журнале аудита и журнале выгрузок.
              </p>
              <p className="text-[10px] text-slate-500 text-center">
                {violation.is_acknowledged && violation.acknowledged_by
                  ? `Отработал: @${violation.acknowledged_by}`
                  : "Ожидает подтверждения охраной"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
