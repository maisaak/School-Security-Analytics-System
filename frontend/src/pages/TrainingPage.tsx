import React, { useCallback, useEffect, useState } from "react";
import { BrainCircuit, CheckCircle2, Database, Play, Upload } from "lucide-react";
import { api, DatasetInfo, RetrainJob, ViolationType } from "../api/client";

export const TrainingPage: React.FC = () => {
  const [dataset, setDataset] = useState<DatasetInfo | null>(null);
  const [jobs, setJobs] = useState<RetrainJob[]>([]);
  const [epochs, setEpochs] = useState(6);
  const [sampleClass, setSampleClass] = useState<ViolationType>("suspicious_bag");
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [box, setBox] = useState<number[] | null>(null);
  const [anchor, setAnchor] = useState<number[] | null>(null);
  const [split, setSplit] = useState("train");

  useEffect(() => {
    if (!sampleFile) { setSampleUrl(null); return; }
    const url = URL.createObjectURL(sampleFile);
    setSampleUrl(url); setBox(null);
    return () => URL.revokeObjectURL(url);
  }, [sampleFile]);

  const loadState = useCallback(async () => {
    try {
      const [ds, jb] = await Promise.all([api.getDatasetInfo(), api.getRetrainJobs()]);
      setDataset(ds);
      setJobs(jb);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки данных обучения");
    }
  }, []);

  const activeJob = jobs.find((j) => j.status === "queued" || j.status === "running");
  const latestCompleted = jobs.find((j) => j.status === "ready" || j.status === "active");

  useEffect(() => {
    loadState();
    const interval = setInterval(loadState, activeJob ? 1200 : 4000);
    return () => clearInterval(interval);
  }, [loadState, Boolean(activeJob)]);

  const handleStartRetrain = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.retrainModel(epochs);
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запустить дообучение");
    }
  };

  const handleSampleUpload = async (file: File) => {
    setError(null);
    if (!box || box[2] - box[0] < 0.005 || box[3] - box[1] < 0.005) { setError("Обведите объект рамкой на изображении"); return; }
    setUploadStatus("Добавление подтверждённой разметки...");
    try {
      const res = await api.uploadDatasetSample(file, sampleClass, box, split);
      setDataset(res.dataset);
      setUploadStatus(`Снимок ${res.filename} добавлен в ${split}`);
      setSampleFile(null);
    } catch (err) {
      setUploadStatus(null);
      setError(err instanceof Error ? err.message : "Ошибка добавления снимка");
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Управление запуском дообучения */}
        <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/25">
              <BrainCircuit className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Дообучение нейросети YOLO</h2>
              <p className="text-xs text-slate-400">
                Обучение кандидата на проверенной разметке. Применение к камерам — только вручную.
              </p>
            </div>
          </div>

          <form onSubmit={handleStartRetrain} className="space-y-4">
            <div className="training-slider-card">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300 font-medium">Количество эпох обучения</span>
                <span className="training-slider-value">{epochs} эпох</span>
              </div>
              <input
                aria-label="Количество эпох обучения"
                type="range"
                min={2}
                max={25}
                step={1}
                value={epochs}
                onChange={(e) => setEpochs(Number(e.target.value))}
                className="modern-range"
                style={{ "--range-progress": `${((epochs - 2) / 23) * 100}%` } as React.CSSProperties}
              />
              <div className="training-slider-labels">
                <span>Быстрый прогон (2 эп.)</span>
                <span>Рекомендуемо (6–8 эп.)</span>
                <span>Глубокое обучение (25 эп.)</span>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-950/60 border border-red-700/50 text-xs text-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={Boolean(activeJob)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium text-white transition"
            >
              <Play className="w-4 h-4" />
              {activeJob
                ? `Выполняется обучение (${activeJob.current_epoch}/${activeJob.epochs})...`
                : "Запустить дообучение модели"}
            </button>
          </form>

          {activeJob && (
            <div className="bg-indigo-950/40 border border-indigo-500/40 rounded-xl p-4 space-y-2.5">
              <div className="flex justify-between text-xs">
                <span className="font-semibold text-indigo-200">
                  Задача #{activeJob.id} · {activeJob.details}
                </span>
                <span className="font-mono text-indigo-300">{activeJob.progress_pct}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-900 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-500"
                  style={{ width: `${Math.max(8, activeJob.progress_pct)}%` }}
                />
              </div>
            </div>
          )}

          {latestCompleted && (
            <div className="pt-2 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Метрики валидации задачи #{latestCompleted.id} ({latestCompleted.details})
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {
                    label: "mAP@50",
                    value:
                      latestCompleted.metrics["metrics/mAP50(B)"] !== undefined
                        ? `${(latestCompleted.metrics["metrics/mAP50(B)"] * 100).toFixed(1)}%`
                        : "—",
                  },
                  {
                    label: "mAP@50-95",
                    value:
                      latestCompleted.metrics["metrics/mAP50-95(B)"] !== undefined
                        ? `${(latestCompleted.metrics["metrics/mAP50-95(B)"] * 100).toFixed(1)}%`
                        : "—",
                  },
                  {
                    label: "Precision",
                    value:
                      latestCompleted.metrics["metrics/precision(B)"] !== undefined
                        ? `${(latestCompleted.metrics["metrics/precision(B)"] * 100).toFixed(1)}%`
                        : "—",
                  },
                  {
                    label: "Recall",
                    value:
                      latestCompleted.metrics["metrics/recall(B)"] !== undefined
                        ? `${(latestCompleted.metrics["metrics/recall(B)"] * 100).toFixed(1)}%`
                        : "—",
                  },
                ].map((m) => (
                  <div key={m.label} className="bg-slate-950/80 border border-slate-800 rounded-xl p-3">
                    <p className="text-[11px] text-slate-400">{m.label}</p>
                    <p className="text-lg font-bold font-mono text-emerald-400 mt-0.5">{m.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Пополнение датасета */}
        <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Датасет школьной безопасности</h3>
              <p className="text-xs text-slate-400">
                Train: {dataset?.train_images ?? 0} кадров · Val: {dataset?.val_images ?? 0} кадров
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {[
              { key: "dog", title: "0: Собака", count: dataset?.class_annotations?.dog ?? 0 },
              { key: "weapon", title: "1: Оружие", count: dataset?.class_annotations?.weapon ?? 0 },
              { key: "suspicious_bag", title: "2: Сумка", count: dataset?.class_annotations?.suspicious_bag ?? 0 },
            ].map((c) => (
              <div key={c.key} className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 text-center">
                <p className="text-[11px] text-slate-400">{c.title}</p>
                <p className="text-lg font-bold font-mono text-white mt-0.5">{c.count}</p>
                <p className="text-[10px] text-slate-500">аннотаций</p>
              </div>
            ))}
          </div>

          <div className="space-y-3 pt-2 border-t border-slate-800">
            <p className="text-xs font-medium text-slate-300">Добавить новый пример для дообучения:</p>
            <select
              value={sampleClass}
              onChange={(e) => setSampleClass(e.target.value as ViolationType)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
            >
              <option value="suspicious_bag">Класс 2 — Подозрительная сумка (suspicious_bag)</option>
              <option value="weapon">Класс 1 — Оружие (weapon)</option>
              <option value="dog">Класс 0 — Собака (dog)</option>
            </select>

            <label className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-dashed border-slate-700 hover:border-emerald-500 bg-slate-950/60 text-xs font-medium text-slate-200 cursor-pointer transition">
              <Upload className="w-4 h-4 text-emerald-400" />
              Загрузить снимок в обучающую выборку
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setSampleFile(f); setUploadStatus(null); }
                }}
              />
            </label>

            {sampleUrl && <div className="space-y-3">
              <p className="text-xs text-slate-300">Обведите один объект рамкой. Для снимков с несколькими объектами используйте внешнюю YOLO-разметку: все целевые объекты должны быть размечены.</p>
              <div className="relative select-none touch-none" onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const r = e.currentTarget.getBoundingClientRect();
                const p = [(e.clientX-r.left)/r.width, (e.clientY-r.top)/r.height];
                setAnchor(p); setBox([...p, ...p]);
              }} onPointerMove={(e) => {
                if (!anchor) return;
                const r = e.currentTarget.getBoundingClientRect();
                const x = Math.max(0, Math.min(1, (e.clientX-r.left)/r.width));
                const y = Math.max(0, Math.min(1, (e.clientY-r.top)/r.height));
                setBox([Math.min(anchor[0],x), Math.min(anchor[1],y), Math.max(anchor[0],x), Math.max(anchor[1],y)]);
              }} onPointerUp={() => setAnchor(null)} onPointerCancel={() => setAnchor(null)}>
                <img src={sampleUrl} alt="Изображение для ручной разметки" draggable={false} className="w-full rounded-lg" />
                {box && <div className="absolute border-2 border-emerald-400 bg-emerald-400/10 pointer-events-none" style={{left:`${box[0]*100}%`,top:`${box[1]*100}%`,width:`${(box[2]-box[0])*100}%`,height:`${(box[3]-box[1])*100}%`}} />}
              </div>
              <select aria-label="Раздел выборки" value={split} onChange={(e) => setSplit(e.target.value)} className="bg-slate-950 p-2 rounded-lg text-xs">
                <option value="train">Train — обучение</option><option value="val">Val — независимая валидация</option>
              </select>
              <button disabled={!box || !!anchor} onClick={() => sampleFile && handleSampleUpload(sampleFile)} className="block bg-emerald-700 disabled:opacity-50 rounded-lg px-3 py-2 text-xs">Подтвердить рамку и добавить</button>
            </div>}
            {uploadStatus && (
              <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-700/50 text-xs text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                {uploadStatus}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* История задач дообучения */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white">Журнал задач обучения (Celery / Worker)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="text-slate-400 uppercase border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-2">ID</th>
                <th className="py-2.5 px-2">Статус</th>
                <th className="py-2.5 px-2">Прогресс</th>
                <th className="py-2.5 px-2">mAP@50</th>
                <th className="py-2.5 px-2">Детали</th>
                <th className="py-2.5 px-2">Дата запуска</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="py-2.5 px-2 font-mono text-slate-300">#{job.id}</td>
                  <td className="py-2.5 px-2">
                    <span
                      className={`px-2 py-0.5 rounded-full font-medium ${
                          ["completed", "ready", "active"].includes(job.status)
                          ? "bg-emerald-500/15 text-emerald-300"
                          : job.status === "failed"
                          ? "bg-red-500/15 text-red-300"
                          : "bg-indigo-500/20 text-indigo-300"
                      }`}
                    >
                      {job.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 font-mono">
                    {job.current_epoch}/{job.epochs} ({job.progress_pct}%)
                  </td>
                  <td className="py-2.5 px-2 font-mono text-emerald-400">
                    {job.metrics["metrics/mAP50(B)"] !== undefined
                      ? `${(job.metrics["metrics/mAP50(B)"] * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="py-2.5 px-2 text-slate-300">{job.details}
                    {job.status === "ready" && <button className="block mt-2 bg-amber-700 rounded-lg p-2 text-white" onClick={async () => {
                      if (!window.confirm("Применить модель? Подтвердите, что проверили её на независимых реальных записях. Старые кандидаты остаются для отката.")) return;
                      try { await api.activateModel(job.id); await loadState(); }
                      catch (err) { setError(err instanceof Error ? err.message : "Ошибка активации"); }
                    }}>Применить после проверки</button>}
                  </td>
                  <td className="py-2.5 px-2 font-mono text-slate-400">
                    {new Date(job.created_at).toLocaleString("ru-RU")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
