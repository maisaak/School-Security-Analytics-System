import React from "react";
import { CheckCircle2, Download, Hourglass, ScanEye, X } from "lucide-react";
import { Violation } from "../api/client";
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
  const downloadUrl = `/api/violations/${violation.id}/video?download=true`;
  const snapshotUrl = `${violation.image_path}?download=true`;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full p-4 sm:p-6 space-y-4 shadow-2xl max-h-[96vh] overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border ${meta.badgeClass}`}>
              {meta.title}
            </span>
            <div className="min-w-0">
              <h3 className="font-semibold text-white text-sm truncate">
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
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
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
              src={violation.video_url}
              controls
              autoPlay
              loop
              playsInline
              className="w-full aspect-video object-contain bg-black"
            />
          </div>

          <div className="space-y-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
            <p className="text-[11px] font-medium text-slate-400">Стоп-кадр срабатывания YOLOv8</p>
            <a href={snapshotUrl} download={`incident_${violation.id}.jpg`} title="Скачать фото улики">
              <img
                src={violation.image_path}
                alt={meta.title}
                className="w-full rounded-lg border border-slate-800 object-cover hover:opacity-90 transition"
              />
            </a>
            <div className="pt-2 space-y-2">
              {canAck && (
                <button
                  onClick={() => onAcknowledge(violation.id)}
                  className={`w-full py-2 px-3 rounded-xl text-[11px] font-medium text-white flex items-center justify-center gap-2 transition ${
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
