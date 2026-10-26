import React from "react";
import { CheckCircle2, Download, X } from "lucide-react";
import { Violation } from "../api/client";
import { VIOLATION_META } from "./ViolationsTable";

interface VideoModalProps {
  canAcknowledge: boolean;
  violation: Violation | null;
  onClose: () => void;
  onAcknowledge: (id: number) => void;
}

export const VideoModal: React.FC<VideoModalProps> = ({
  canAcknowledge,
  violation,
  onClose,
  onAcknowledge,
}) => {
  if (!violation) return null;
  const meta = VIOLATION_META[violation.violation_type] ?? VIOLATION_META.suspicious_bag;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full p-5 sm:p-6 space-y-4 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.badgeClass}`}>
              {meta.title}
            </span>
            <div>
              <h3 className="font-semibold text-white text-sm sm:text-base">
                Инцидент #{violation.id} · {violation.camera_name}
              </h3>
              <p className="text-xs text-slate-400">
                {violation.camera_location} · Уверенность {(violation.confidence * 100).toFixed(1)}% ·{" "}
                {new Date(violation.detected_at).toLocaleString("ru-RU")}
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <div className="lg:col-span-2 bg-black rounded-xl overflow-hidden border border-slate-800">
            {violation.video_url ? <video
              key={violation.video_url}
              src={violation.video_url}
              controls
              autoPlay
              loop
              playsInline
              className="w-full aspect-video object-contain bg-black"
            /> : <img src={violation.image_path} alt="Фото инцидента — видеозапись не создавалась" className="w-full aspect-video object-contain" />}
          </div>

          <div className="space-y-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
            <p className="text-xs font-medium text-slate-400">Стоп-кадр срабатывания YOLOv8</p>
            <img
              src={violation.image_path}
              alt={meta.title}
              className="w-full rounded-lg border border-slate-800 object-cover"
            />
            <div className="pt-2 space-y-2">
              <button
                disabled={violation.is_acknowledged || !canAcknowledge}
                onClick={() => onAcknowledge(violation.id)}
                className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white flex items-center justify-center gap-2 transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                {violation.is_acknowledged ? "Проверено" : "Отметить как отработанный"}
              </button>
              <a
                href={violation.video_url || violation.image_path}
                download={`incident_${violation.id}.${violation.video_url ? "mp4" : "jpg"}`}
                className="w-full py-2 px-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-200 flex items-center justify-center gap-2 transition"
              >
                <Download className="w-4 h-4" />
                {violation.video_url ? "Скачать MP4 фрагмент" : "Скачать фото"}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
