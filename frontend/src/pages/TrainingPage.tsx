import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  BrainCircuit,
  CheckCircle2,
  Database,
  FileUp,
  GitBranch,
  History,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  Cpu,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  api,
  DatasetInfo,
  DetectorProfile,
  ModelCatalog,
  ModelVersion,
  RetrainJob,
  ModelUploadResult,
  ValidationGateInfo,
  ViolationType,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorNotice, formatBytes, formatDateTime, Pill, SectionCard } from "../components/ui";

const STATUS_META: Record<string, { label: string; tone: "emerald" | "red" | "amber" | "slate" | "indigo" }> = {
  production: { label: "боевая", tone: "emerald" },
  archived: { label: "архив", tone: "slate" },
  rejected: { label: "отклонена Gate", tone: "red" },
  candidate: { label: "кандидат", tone: "amber" },
  completed: { label: "завершена", tone: "emerald" },
  running: { label: "обучение…", tone: "indigo" },
  queued: { label: "в очереди", tone: "amber" },
  failed: { label: "ошибка", tone: "red" },
};

export const TrainingPage: React.FC = () => {
  const { can } = useAuth();
  const [dataset, setDataset] = useState<DatasetInfo | null>(null);
  const [jobs, setJobs] = useState<RetrainJob[]>([]);
  const [versions, setVersions] = useState<ModelVersion[]>([]);
  const [gate, setGate] = useState<ValidationGateInfo | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [epochs, setEpochs] = useState(6);
  const [sampleClass, setSampleClass] = useState<ViolationType>("suspicious_bag");
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<ModelVersion | null>(null);
  const [rollbackReason, setRollbackReason] = useState("Деградация качества модели на реальных кадрах");
  const [rollbackForce, setRollbackForce] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Загрузка собственных весов (YOLO11 и другие семейства)
  const [weightFile, setWeightFile] = useState<File | null>(null);
  const [weightLabel, setWeightLabel] = useState("");
  const [weightArchitecture, setWeightArchitecture] = useState("auto");
  const [weightMap50, setWeightMap50] = useState("");
  const [weightActivate, setWeightActivate] = useState(false);
  const [weightNotes, setWeightNotes] = useState("");
  const [uploadingWeights, setUploadingWeights] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<ModelUploadResult | null>(null);

  const canTrain = can("models:train");
  const canRollback = can("models:rollback");

  const loadState = useCallback(async () => {
    try {
      const [ds, jb, vs, gt, cat] = await Promise.all([
        api.getDatasetInfo(),
        api.getRetrainJobs(),
        api.getModelVersions(),
        api.getValidationGate(),
        api.getModelCatalog().catch(() => null),
      ]);
      setDataset(ds);
      setJobs(jb);
      setVersions(vs);
      setGate(gt);
      setCatalog(cat);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить состояние обучения");
    }
  }, []);

  const activeJob = jobs.find((j) => j.status === "queued" || j.status === "running");

  useEffect(() => {
    loadState();
    const interval = setInterval(loadState, activeJob ? 1500 : 5000);
    return () => clearInterval(interval);
  }, [loadState, Boolean(activeJob)]);

  const handleStartRetrain = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStarting(true);
    try {
      await api.retrainModel(epochs);
      setNotice("Задача дообучения запущена. Результат проверит Validation Gate.");
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запустить дообучение");
    } finally {
      setStarting(false);
    }
  };

  const handleSampleUpload = async (file: File) => {
    setError(null);
    setUploadStatus("Авторазметка bbox и добавление примера в обучающую выборку…");
    try {
      const res = await api.uploadDatasetSample(file, sampleClass);
      setUploadStatus(`Добавлен пример ${res.filename} (класс ${sampleClass})`);
      setDataset(res.dataset);
    } catch (err) {
      setUploadStatus(null);
      setError(err instanceof Error ? err.message : "Не удалось загрузить пример");
    }
  };

  const handleRollback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rollbackTarget) return;
    setRollingBack(true);
    setError(null);
    try {
      const version = await api.rollbackVersion(rollbackTarget.id, rollbackReason, rollbackForce);
      setNotice(`Активирована версия ${version.label} · mAP@50 ${version.map50 ? (version.map50 * 100).toFixed(1) + "%" : "—"}`);
      setRollbackTarget(null);
      setRollbackForce(false);
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить откат");
    } finally {
      setRollingBack(false);
    }
  };

  const handleWeightsUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!weightFile) {
      setUploadError("Выберите файл весов .pt");
      return;
    }
    setUploadingWeights(true);
    setUploadError(null);
    setUploadResult(null);
    try {
      const result = await api.uploadModel({
        file: weightFile,
        label: weightLabel,
        architecture: weightArchitecture,
        map50: weightMap50.trim() === "" ? null : Number(weightMap50),
        activate: weightActivate,
        notes: weightNotes,
      });
      setUploadResult(result);
      setWeightFile(null);
      setWeightLabel("");
      setWeightNotes("");
      setWeightMap50("");
      setWeightActivate(false);
      await loadState();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Не удалось загрузить веса");
    } finally {
      setUploadingWeights(false);
    }
  };

  const handleDeleteVersion = async (version: ModelVersion) => {
    if (!window.confirm(`Удалить версию «${version.label}» из реестра? Файл весов будет удалён безвозвратно.`)) {
      return;
    }
    try {
      await api.deleteModelVersion(version.id);
      setNotice(`Версия «${version.label}» удалена из реестра`);
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить версию");
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
          <BrainCircuit className="w-5 h-5 text-brand-400" />
          Модели YOLO: дообучение, загрузка весов и реестр версий
        </h2>
        <p className="text-[11px] text-slate-400">
          Подключите YOLO11 (или другую архитектуру) загрузкой .pt · Validation Gate не пропускает в production версии
          с падением mAP@50 · доступен откат на любую версию реестра
        </p>
      </div>

      {error && <ErrorNotice message={error} onRetry={loadState} />}
      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200">
          <CheckCircle2 className="w-4 h-4" />
          {notice}
        </div>
      )}

      {gate && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.07] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold text-ink">Validation Gate активен</span>
              </div>
              <Pill tone="emerald">
                допуск mAP@50 ≥ baseline − {(gate.tolerance * 100).toFixed(1)} п.п.
              </Pill>
            </div>
            <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div>
                <p className="text-slate-500">Боевая версия</p>
                <p className="font-mono text-emerald-300 truncate">{gate.production?.label ?? "—"}</p>
              </div>
              <div>
                <p className="text-slate-500">mAP@50</p>
                <p className="font-mono text-ink">
                  {gate.production?.map50 !== null && gate.production?.map50 !== undefined
                    ? `${(gate.production.map50 * 100).toFixed(2)}%`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-slate-500">mAP@50-95</p>
                <p className="font-mono text-slate-300">
                  {gate.production?.map50_95 !== null && gate.production?.map50_95 !== undefined
                    ? `${(gate.production.map50_95 * 100).toFixed(2)}%`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Минимальный порог</p>
                <p className="font-mono text-slate-300">{(gate.min_absolute_map50 * 100).toFixed(0)}%</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
            <p className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Отклонено Gate ({gate.recent_rejections.length})
            </p>
            {gate.recent_rejections.length === 0 ? (
              <p className="text-[10px] text-slate-500">Пока нет отклонённых версий</p>
            ) : (
              <div className="space-y-1.5">
                {gate.recent_rejections.slice(0, 3).map((r) => (
                  <div key={r.id} className="rounded-lg bg-slate-950/70 border border-red-500/25 px-2 py-1.5">
                    <p className="text-[10px] font-mono text-red-300 truncate">{r.label}</p>
                    <p className="text-[9px] text-slate-500">
                      mAP@50 {r.map50 !== null ? `${(r.map50 * 100).toFixed(1)}%` : "—"} · baseline{" "}
                      {r.baseline_map50 !== null ? `${(r.baseline_map50 * 100).toFixed(1)}%` : "—"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-7 space-y-4">
          <SectionCard
            title="Датасет и запуск обучения"
            subtitle="Инкрементальное дообучение на школьных классах: dog, weapon, suspicious_bag"
            icon={Database}
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {[
                { label: "Всего изображений", value: dataset?.total_images ?? 0 },
                { label: "Train", value: dataset?.train_images ?? 0 },
                { label: "Val", value: dataset?.val_images ?? 0 },
                { label: "Загружено вручную", value: dataset?.user_uploaded_images ?? 0 },
              ].map((item) => (
                <div key={item.label} className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2.5">
                  <p className="text-[9px] text-slate-500">{item.label}</p>
                  <p className="text-lg font-bold text-ink">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-1.5 mb-4">
              {Object.entries(dataset?.class_annotations ?? {}).map(([cls, count]) => (
                <Pill key={cls} tone="slate">
                  {cls}: <span className="font-mono">{count}</span>
                </Pill>
              ))}
            </div>

            {canTrain ? (
              <>
                <form onSubmit={handleStartRetrain} className="flex flex-wrap items-end gap-2.5">
                  <div className="flex-1 min-w-[140px]">
                    <label className="block text-[10px] text-slate-400 mb-1">Количество эпох</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={epochs}
                      onChange={(e) => setEpochs(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-brand-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={Boolean(activeJob) || starting}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-xs font-medium text-white transition"
                  >
                    {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    {activeJob ? `Задача #${activeJob.id} выполняется` : "Запустить дообучение"}
                  </button>
                </form>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={sampleClass}
                    onChange={(e) => setSampleClass(e.target.value as ViolationType)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-brand-500"
                  >
                    <option value="suspicious_bag">Класс 2 — Бесхозная сумка</option>
                    <option value="weapon">Класс 1 — Оружие</option>
                    <option value="dog">Класс 0 — Собака</option>
                  </select>
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-slate-700 hover:border-brand-500 bg-slate-950/60 text-[11px] font-medium text-slate-200 cursor-pointer transition">
                    <Upload className="w-3.5 h-3.5 text-brand-400" />
                    Добавить размеченный снимок
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleSampleUpload(f);
                      }}
                    />
                  </label>
                </div>
              </>
            ) : (
              <p className="text-[11px] text-slate-500 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                Запуск дообучения и загрузка примеров доступны только администратору.
              </p>
            )}

            {uploadStatus && (
              <div className="tinted-green mt-3 p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-700/50 text-[11px] text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                {uploadStatus}
              </div>
            )}

            {activeJob && (
              <div className="mt-4 rounded-xl border border-brand-500/30 bg-brand-500/[0.07] p-3">
                <div className="flex items-center justify-between text-[11px] mb-2">
                  <span className="text-brand-200">
                    Задача #{activeJob.id} · эпоха {activeJob.current_epoch}/{activeJob.epochs}
                  </span>
                  <span className="font-mono text-brand-300">{activeJob.progress_pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-950 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-brand-500 to-sky-400 transition-all duration-500"
                    style={{ width: `${activeJob.progress_pct}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-2">{activeJob.details}</p>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Загрузить свои веса (YOLO11 и др.)"
            subtitle="Чекпоинт Ultralytics .pt: архитектура, задача и классы определяются автоматически"
            icon={FileUp}
          >
            {canTrain ? (
              <form onSubmit={handleWeightsUpload} className="space-y-3">
                <label className="flex items-center gap-3 rounded-xl border border-dashed border-slate-700 hover:border-brand-500 bg-slate-950/60 px-3 py-3 cursor-pointer transition">
                  <FileUp className="w-5 h-5 text-brand-400 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-medium text-ink truncate">
                      {weightFile ? weightFile.name : "Выберите файл весов .pt"}
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      {weightFile
                        ? `${(weightFile.size / 1024 / 1024).toFixed(1)} МБ · готов к проверке`
                        : "YOLOv8 / YOLO11 / YOLOv10 / YOLOv9, до 200 МБ"}
                    </span>
                  </span>
                  <input
                    type="file"
                    accept=".pt"
                    className="hidden"
                    onChange={(event) => {
                      setWeightFile(event.target.files?.[0] ?? null);
                      setUploadResult(null);
                      setUploadError(null);
                    }}
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Название версии</label>
                    <input
                      value={weightLabel}
                      onChange={(event) => setWeightLabel(event.target.value)}
                      maxLength={80}
                      placeholder="Например, YOLO11s шлемы и оружие"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Архитектура</label>
                    <select
                      value={weightArchitecture}
                      onChange={(event) => setWeightArchitecture(event.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-brand-500"
                    >
                      {(catalog?.supported_architectures?.length
                        ? catalog.supported_architectures
                        : [
                            { key: "auto", label: "Определить автоматически" },
                            { key: "yolov8", label: "YOLOv8" },
                            { key: "yolo11", label: "YOLO11" },
                            { key: "yolo10", label: "YOLOv10" },
                            { key: "yolo9", label: "YOLOv9" },
                            { key: "custom", label: "Своя архитектура" },
                          ]
                      ).map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">
                      mAP@50 на валидации, % (необязательно)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={weightMap50}
                      onChange={(event) => setWeightMap50(event.target.value)}
                      placeholder="например, 91.5"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">Комментарий</label>
                    <input
                      value={weightNotes}
                      onChange={(event) => setWeightNotes(event.target.value)}
                      maxLength={240}
                      placeholder="Датасет, автор, особенности обучения"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-brand-500"
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2 text-[10px] text-slate-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={weightActivate}
                    onChange={(event) => setWeightActivate(event.target.checked)}
                    className="mt-0.5 rounded accent-emerald-500"
                  />
                  <span>
                    Сделать боевой сразу после проверки Validation Gate.
                    {Number(weightMap50) > 0
                      ? " При деградации mAP@50 активация будет заблокирована."
                      : " Без mAP@50 активация недоступна — версия останется кандидатом."}
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={uploadingWeights || !weightFile}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-xs font-medium text-white transition"
                >
                  {uploadingWeights ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  {uploadingWeights ? "Проверяем веса…" : "Загрузить и проверить"}
                </button>

                {uploadError && (
                  <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[10px] text-red-200">
                    {uploadError}
                  </div>
                )}

                {uploadResult && (
                  <div
                    className={`rounded-xl border px-3 py-2.5 space-y-1 ${
                      uploadResult.gate_passed === false
                        ? "border-amber-500/40 bg-amber-500/10"
                        : "border-emerald-500/40 bg-emerald-500/10"
                    }`}
                  >
                    <p className="text-[11px] font-medium text-ink flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                      {uploadResult.message}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {uploadResult.inspection.architecture.toUpperCase()} · классов:{" "}
                      {uploadResult.inspection.num_classes} (
                      {uploadResult.inspection.classes.slice(0, 6).join(", ")}
                      {uploadResult.inspection.classes.length > 6 ? "…" : ""}) · версия №
                      {uploadResult.version.id}
                    </p>
                    {uploadResult.gate_notes && (
                      <p
                        className={`text-[10px] ${
                          uploadResult.gate_passed === false ? "text-amber-200" : "text-slate-400"
                        }`}
                      >
                        {uploadResult.gate_notes}
                      </p>
                    )}
                  </div>
                )}
              </form>
            ) : (
              <p className="text-[11px] text-slate-500 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                Загрузка и удаление весов доступны только администратору.
              </p>
            )}
          </SectionCard>

          <SectionCard title="Журнал задач обучения" subtitle="Celery / локальный воркер" icon={History}>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-left">
                <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-2">ID</th>
                    <th className="py-2 px-2">Статус</th>
                    <th className="py-2 px-2">mAP@50</th>
                    <th className="py-2 px-2">Gate</th>
                    <th className="py-2 px-2">Детали</th>
                    <th className="py-2 px-2">Запуск</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {jobs.map((job) => {
                    const meta = STATUS_META[job.status] ?? STATUS_META.queued;
                    return (
                      <tr key={job.id} className="align-top">
                        <td className="py-2 px-2 font-mono text-[10px] text-slate-300">#{job.id}</td>
                        <td className="py-2 px-2">
                          <Pill tone={meta.tone}>{meta.label}</Pill>
                        </td>
                        <td className="py-2 px-2 font-mono text-[10px] text-emerald-300">
                          {job.metrics["metrics/mAP50(B)"] !== undefined
                            ? `${(job.metrics["metrics/mAP50(B)"] * 100).toFixed(1)}%`
                            : job.final_map50 !== null
                            ? `${(job.final_map50 * 100).toFixed(1)}%`
                            : "—"}
                        </td>
                        <td className="py-2 px-2">
                          {job.validation_passed === null ? (
                            <span className="text-[10px] text-slate-600">—</span>
                          ) : job.validation_passed ? (
                            <Pill tone="emerald">пройден</Pill>
                          ) : (
                            <Pill tone="red">отклонён</Pill>
                          )}
                        </td>
                        <td className="py-2 px-2 text-[10px] text-slate-400 max-w-[260px]">{job.details}</td>
                        <td className="py-2 px-2 text-[10px] font-mono text-slate-500 whitespace-nowrap">
                          {formatDateTime(job.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                  {jobs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-[11px] text-slate-500">
                        Задач обучения пока нет
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>

        <div className="lg:col-span-5">
          <SectionCard
            title="Реестр версий весов"
            subtitle="Production, кандидаты и архив с возможностью отката"
            icon={GitBranch}
            actions={<Pill tone="slate">версий: {versions.length}</Pill>}
          >
            <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1 -mr-1">
              {versions.map((version) => {
                const meta = STATUS_META[version.status] ?? STATUS_META.candidate;
                const isCurrent = version.is_current || version.status === "production";
                return (
                  <div
                    key={version.id}
                    className={`rounded-xl border p-2.5 ${
                      isCurrent
                        ? "border-emerald-500/50 bg-emerald-500/[0.07]"
                        : version.status === "rejected"
                        ? "border-red-500/40 bg-red-500/[0.05]"
                        : "border-slate-800 bg-slate-950/60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-ink font-mono truncate">
                            {version.label}
                          </span>
                          <Pill tone={meta.tone}>{meta.label}</Pill>
                          <Pill tone="slate">{version.architecture?.toUpperCase() ?? "YOLOV8"}</Pill>
                          {isCurrent && (
                            <Pill tone="emerald">
                              <ShieldCheck className="w-2.5 h-2.5" /> активна
                            </Pill>
                          )}
                        </div>
                        <p className="text-[9px] text-slate-500 font-mono truncate mt-0.5">
                          {version.weights_path}
                        </p>
                      </div>
                      {canRollback && !isCurrent && (
                        <div className="shrink-0 flex items-center gap-1">
                          <button
                            onClick={() => {
                              setRollbackTarget(version);
                              setRollbackForce(version.validation_passed === false);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-brand-600 text-[10px] font-medium text-slate-200 hover:text-white transition"
                            title="Откатиться на эту версию"
                          >
                            <RotateCcw className="w-3 h-3" /> Откат
                          </button>
                          <button
                            onClick={() => handleDeleteVersion(version)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-500/10 transition"
                            title="Удалить версию из реестра"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-[10px]">
                      <div>
                        <p className="text-slate-500">mAP@50</p>
                        <p className="font-mono text-slate-200">
                          {version.map50 !== null ? `${(version.map50 * 100).toFixed(1)}%` : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Δ к базовой</p>
                        <p
                          className={`font-mono ${
                            version.delta_map50 === null
                              ? "text-slate-500"
                              : version.delta_map50 < 0
                              ? "text-red-300"
                              : "text-emerald-300"
                          }`}
                        >
                          {version.delta_map50 !== null
                            ? `${version.delta_map50 > 0 ? "+" : ""}${(version.delta_map50 * 100).toFixed(2)} п.п.`
                            : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Размер</p>
                        <p className="font-mono text-slate-400">{formatBytes(version.size_bytes)}</p>
                      </div>
                    </div>

                    {version.validation_notes && (
                      <p
                        className={`mt-1.5 text-[9px] leading-snug ${
                          version.validation_passed === false ? "text-red-300/90" : "text-slate-500"
                        }`}
                      >
                        {version.validation_notes}
                      </p>
                    )}

                    <p className="mt-1 text-[9px] text-slate-600 font-mono">
                      {formatDateTime(version.created_at)} · {version.created_by} · sha256{" "}
                      {version.sha256.slice(0, 10)}…
                    </p>
                  </div>
                );
              })}
              {versions.length === 0 && (
                <p className="py-6 text-center text-[11px] text-slate-500">Реестр пуст</p>
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      {rollbackTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleRollback}
            className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                  <ArrowDownToLine className="w-4 h-4 text-brand-400" />
                  Откат на версию {rollbackTarget.label}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  mAP@50 {rollbackTarget.map50 !== null ? `${(rollbackTarget.map50 * 100).toFixed(2)}%` : "—"} ·{" "}
                  {formatDateTime(rollbackTarget.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRollbackTarget(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {rollbackTarget.validation_passed === false && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[10px] text-red-200">
                Эта версия была отклонена Validation Gate — её mAP@50 ниже базового. Откат требует явного
                подтверждения «force».
              </div>
            )}

            <div>
              <label className="block text-[10px] text-slate-400 mb-1">Причина отката</label>
              <textarea
                value={rollbackReason}
                onChange={(e) => setRollbackReason(e.target.value)}
                rows={2}
                required
                maxLength={240}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-brand-500 resize-none"
              />
            </div>

            {rollbackTarget.validation_passed === false && (
              <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rollbackForce}
                  onChange={(e) => setRollbackForce(e.target.checked)}
                  className="rounded accent-red-500"
                />
                Подтверждаю принудительную активацию версии, отклонённой Gate
              </label>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRollbackTarget(null)}
                className="px-3 py-2 rounded-xl border border-slate-700 text-xs text-slate-300 hover:bg-slate-800"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={rollingBack || (rollbackTarget.validation_passed === false && !rollbackForce)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-xs font-medium text-white transition"
              >
                {rollingBack ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                Выполнить откат
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
