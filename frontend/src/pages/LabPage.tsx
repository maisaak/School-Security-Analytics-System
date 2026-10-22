import React, { useState } from "react";
import { CheckCircle2, FileVideo, ImageIcon, Upload } from "lucide-react";
import { AnalyzeUploadResult, api } from "../api/client";
import { VIOLATION_META } from "../components/ViolationsTable";

export const LabPage: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saveViolation, setSaveViolation] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeUploadResult | null>(null);

  const runAnalysis = async (file: File) => {
    setSelectedFile(file);
    setLoading(true);
    setError(null);
    try {
      const res = await api.analyzeMedia(file, saveViolation);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка обработки файла");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-ink">Лаборатория проверки медиафайлов</h2>
          <p className="text-xs text-slate-400 mt-1">
            Загрузите фотографию (<code className="text-brand-300">.jpg</code>,{" "}
            <code className="text-brand-300">.png</code>) или видеоролик (
            <code className="text-brand-300">.mp4</code>), чтобы протестировать ансамбль YOLOv8
          </p>
        </div>

        <label className="flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed border-slate-700 hover:border-brand-500 bg-slate-950/60 cursor-pointer transition text-center">
          <div className="p-3 rounded-xl bg-brand-500/15 text-brand-400">
            <Upload className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-ink">
              {selectedFile ? selectedFile.name : "Нажмите или перетащите фото / видео сюда"}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Детекция собак, оружия, бесхозных сумок и присутствия владельца
            </p>
          </div>
          <input
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) runAnalysis(f);
            }}
          />
        </label>

        <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={saveViolation}
            onChange={(e) => setSaveViolation(e.target.checked)}
            className="rounded accent-brand-500"
          />
          Автоматически регистрировать найденные угрозы в журнале нарушений
        </label>

        {loading && (
          <div className="p-3.5 rounded-xl bg-brand-950/60 border border-brand-700/50 text-xs text-brand-200">
            Выполняется прогон нейросети YOLOv8 и рендеринг разметки...
          </div>
        )}

        {error && (
          <div className="tinted-red p-3.5 rounded-xl bg-red-950/60 border border-red-700/50 text-xs text-red-200">
            {error}
          </div>
        )}
      </div>

      <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">Результат инференса YOLOv8</h3>
          {result?.latency_ms !== undefined && (
            <span className="text-xs font-mono text-emerald-400">
              Время отклика: {result.latency_ms.toFixed(1)} мс
            </span>
          )}
        </div>

        {!result ? (
          <div className="aspect-video rounded-xl bg-slate-950 border border-slate-800 flex flex-col items-center justify-center text-slate-500 gap-3">
            <div className="flex items-center gap-3 opacity-60">
              <ImageIcon className="w-7 h-7" />
              <FileVideo className="w-7 h-7" />
            </div>
            <p className="text-xs">Здесь появится размеченный кадр или видеоролик после загрузки</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl overflow-hidden bg-black border border-slate-800">
              {result.media_type === "video" ? (
                <video
                  src={api.mediaUrl(result.result_url)}
                  controls
                  autoPlay
                  loop
                  className="w-full aspect-video object-contain"
                />
              ) : (
                <img
                  src={api.mediaUrl(result.result_url)}
                  alt="Результат анализа YOLOv8"
                  className="w-full max-h-[460px] object-contain mx-auto"
                />
              )}
            </div>

            {result.violations.length === 0 ? (
              <div className="tinted-green p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-700/50 text-xs text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                Запрещённых объектов и бесхозных сумок не обнаружено.
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-300">Обнаруженные угрозы:</p>
                <div className="flex flex-wrap gap-2">
                  {result.violations.map((v, idx) => {
                    const meta = VIOLATION_META[v.type] ?? VIOLATION_META.suspicious_bag;
                    return (
                      <span
                        key={idx}
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${meta.badgeClass}`}
                      >
                        {meta.title} · {(v.confidence * 100).toFixed(1)}%
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
