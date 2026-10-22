import React, { useCallback, useEffect, useState } from "react";
import {
  AlertOctagon,
  ArchiveRestore,
  BellRing,
  Clock4,
  DatabaseBackup,
  Download,
  Gauge,
  HardDrive,
  Loader2,
  PlayCircle,
  Radio,
  Save,
  Send,
  ShieldCheck,
  TimerReset,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  api,
  BackupItem,
  ModelExports,
  ModelVersion,
  NotificationSettings,
  OpsOverview,
  RetentionPolicy,
  WatchdogStatus,
} from "../api/client";
import { ErrorNotice, formatBytes, formatDateTime, Pill, SectionCard, Spinner } from "../components/ui";

const TOGGLE_FIELDS: { key: keyof NotificationSettings; label: string }[] = [
  { key: "notify_weapon", label: "Оружие — всем получателям" },
  { key: "notify_bag", label: "Бесхозные сумки — охране" },
  { key: "notify_dog", label: "Собаки на территории" },
  { key: "notify_offline", label: "Камера offline (watchdog)" },
  { key: "notify_emergency", label: "Режим эвакуации" },
];

export const OpsPage: React.FC = () => {
  const [overview, setOverview] = useState<OpsOverview | null>(null);
  const [retention, setRetention] = useState<RetentionPolicy | null>(null);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [backupDir, setBackupDir] = useState("");
  const [watchdog, setWatchdog] = useState<WatchdogStatus | null>(null);
  const [notifications, setNotifications] = useState<NotificationSettings | null>(null);
  const [exportsList, setExportsList] = useState<ModelExports | null>(null);
  const [versions, setVersions] = useState<ModelVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreFor, setRestoreFor] = useState<string | null>(null);
  const [restoreWord, setRestoreWord] = useState("");

  const load = useCallback(async () => {
    try {
      const results = await Promise.allSettled([
        api.getOpsOverview(),
        api.getRetention(),
        api.getBackups(),
        api.getWatchdog(),
        api.getNotifications(),
        api.listModelExports(),
        api.getModelVersions(),
      ]);
      if (results[0].status === "fulfilled") setOverview(results[0].value);
      if (results[1].status === "fulfilled") setRetention(results[1].value);
      if (results[2].status === "fulfilled") {
        setBackups(results[2].value.items);
        setBackupDir(results[2].value.dir);
      }
      if (results[3].status === "fulfilled") setWatchdog(results[3].value);
      if (results[4].status === "fulfilled") setNotifications(results[4].value);
      if (results[5].status === "fulfilled") setExportsList(results[5].value);
      if (results[6].status === "fulfilled") setVersions(results[6].value);
      const failed = results.find((r) => r.status === "rejected");
      if (failed && failed.status === "rejected") {
        throw failed.reason instanceof Error ? failed.reason : new Error("Часть разделов недоступна");
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить состояние системы");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key);
    setNotice(null);
    try {
      setNotice(await action());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Операция не выполнена");
    } finally {
      setBusy(null);
    }
  };

  const saveRetention = () =>
    run("retention", async () => {
      if (!retention) return "";
      await api.updateRetention({
        days: retention.days,
        max_gb: retention.max_gb,
        auto_clean: retention.auto_clean,
      });
      return "Политика хранения сохранена";
    });

  const cleanup = () =>
    run("cleanup", async () => {
      const result = await api.runRetentionCleanup();
      return `Очистка: удалено по сроку ${result.deleted_expired}, по квоте ${result.deleted_by_quota}, сирот ${result.deleted_orphans}. Занято ${result.usage_mb} МБ.`;
    });

  const createBackup = () =>
    run("backup", async () => {
      const item = await api.createBackup();
      return `Резервная копия создана: ${item.filename} (${item.size_mb} МБ)`;
    });

  const restore = (filename: string) =>
    run("restore", async () => {
      const result = await api.restoreBackup(filename, restoreWord);
      setRestoreFor(null);
      setRestoreWord("");
      return `База восстановлена из ${result.source}. Страховочная копия: ${result.safety_copy}`;
    });

  const saveNotifications = () =>
    run("notifications", async () => {
      if (!notifications) return "";
      await api.updateNotifications({
        enabled: notifications.enabled,
        director_chat_id: notifications.director_chat_id,
        guard_chat_id: notifications.guard_chat_id,
        notify_weapon: notifications.notify_weapon,
        notify_bag: notifications.notify_bag,
        notify_dog: notifications.notify_dog,
        notify_offline: notifications.notify_offline,
        notify_emergency: notifications.notify_emergency,
        ...(notifications.bot_token ? { bot_token: notifications.bot_token } : {}),
      });
      return "Настройки Telegram-уведомлений сохранены";
    });

  const testTelegram = () =>
    run("telegram", async () => {
      const result = await api.testNotifications();
      const delivered = result.results.filter((item) => item.sent).length;
      if (result.sent) return `Тестовое сообщение доставлено (${delivered} из ${result.results.length} получателей)`;
      return `Не удалось отправить: ${result.error ?? "проверьте токен бота и chat_id"}`;
    });

  const exportVersion = (versionId: number, format: "onnx" | "engine") =>
    run(`export-${versionId}-${format}`, async () => {
      const result = await api.exportModelVersion(versionId, format);
      return `Экспорт готов: ${result.filename} (${result.size_mb} МБ)`;
    });

  if (loading && !overview) return <Spinner label="Собираем состояние системы…" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
            <Wrench className="w-5 h-5 text-sky-400" /> Эксплуатация и надёжность
          </h2>
          <p className="text-[11px] text-slate-400">
            Watchdog камер, политика хранения, резервное копирование, Telegram-уведомления и метрики
          </p>
        </div>
        {overview && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone="sky">v{overview.version}</Pill>
            <Pill tone={overview.watchdog.enabled ? "emerald" : "amber"}>
              Watchdog {overview.watchdog.enabled ? "включён" : "выключен"}
            </Pill>
            <Pill tone={overview.metrics.enabled ? "emerald" : "slate"}>
              Prometheus {overview.metrics.enabled ? "on" : "off"}
            </Pill>
          </div>
        )}
      </div>

      {error && <ErrorNotice message={error} onRetry={load} />}
      {notice && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200 flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> {notice}
        </div>
      )}

      {overview && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {[
            { label: "База данных", value: `${overview.database.size_mb ?? "—"} МБ`, sub: `${overview.database.engine} · ${overview.database.violations} инцидентов`, icon: HardDrive },
            { label: "Медиа", value: `${overview.media.usage_mb} МБ`, sub: `квота ${overview.media.quota_mb} МБ`, icon: ArchiveRestore },
            { label: "Резервные копии", value: overview.backups.count, sub: overview.backups.latest ? formatDateTime(new Date(overview.backups.latest * 1000).toISOString()) : "ещё нет", icon: DatabaseBackup },
            { label: "SSE-подписчики", value: overview.events.subscribers, sub: `событий опубликовано: ${overview.events.published}`, icon: Radio },
          ].map(({ label, value, sub, icon: Icon }) => (
            <div key={label} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] text-slate-400">{label}</p>
                <p className="text-xl font-bold text-ink mt-1 truncate">{value}</p>
                <p className="text-[10px] text-slate-500 truncate">{sub}</p>
              </div>
              <div className="p-2 rounded-xl border border-slate-700 bg-slate-800/50 text-sky-300 shrink-0">
                <Icon className="w-4 h-4" />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SectionCard
          title="Watchdog камер"
          subtitle="Авто-reconnect зависших RTSP-потоков и алерт в Telegram при offline"
          icon={Gauge}
        >
          {watchdog ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                <Pill tone={watchdog.enabled ? "emerald" : "slate"}>
                  {watchdog.enabled ? "Мониторинг активен" : "Мониторинг выключен"}
                </Pill>
                <Pill tone="slate">Интервал {watchdog.interval_sec} с</Pill>
                <Pill tone="slate">Порог {watchdog.stale_sec} с</Pill>
                {watchdog.last_run && <Pill tone="sky">Проверка: {formatDateTime(watchdog.last_run)}</Pill>}
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {watchdog.workers.length === 0 && (
                  <p className="text-[11px] text-slate-500">Нет активных потоков</p>
                )}
                {watchdog.workers.map((worker) => (
                  <div
                    key={worker.camera_id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] text-slate-200 truncate">{worker.name}</p>
                      <p className="text-[9.5px] text-slate-500 font-mono">
                        {worker.profile} · вариант {worker.variant} · {worker.fps.toFixed(0)} FPS
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <Pill tone={worker.online ? "emerald" : "red"}>
                        {worker.paused ? "пауза" : worker.online ? "online" : "offline"}
                      </Pill>
                      <p className="text-[9px] text-slate-500 mt-0.5">
                        кадр {worker.last_frame_age_sec.toFixed(1)} с назад
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              {watchdog.last_actions.length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Последние действия</p>
                  {watchdog.last_actions.slice(-4).reverse().map((action, index) => (
                    <p key={index} className="text-[10px] text-slate-400 font-mono truncate">
                      {JSON.stringify(action)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">Нет данных watchdog</p>
          )}
        </SectionCard>

        <SectionCard
          title="Политика хранения медиа"
          subtitle="Срок жизни улик, квота на диск и автоматическая очистка"
          icon={Trash2}
        >
          {retention ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <label className="space-y-1">
                  <span className="block text-[10px] uppercase text-slate-500">Хранить, дней</span>
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={retention.days}
                    onChange={(e) => setRetention({ ...retention, days: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[10px] uppercase text-slate-500">Квота, ГБ</span>
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    value={retention.max_gb}
                    onChange={(e) => setRetention({ ...retention, max_gb: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200"
                  />
                </label>
              </div>
              <label className="inline-flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={retention.auto_clean}
                  onChange={(e) => setRetention({ ...retention, auto_clean: e.target.checked })}
                  className="rounded accent-brand-500"
                />
                Автоочистка раз в сутки
              </label>

              <div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                  <span>Занято {retention.usage_mb} МБ</span>
                  <span>квота {retention.quota_mb} МБ</span>
                </div>
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-amber-400"
                    style={{ width: `${Math.min(100, (retention.usage_mb / Math.max(1, retention.quota_mb)) * 100)}%` }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={saveRetention}
                  disabled={busy === "retention"}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-[11px] text-white disabled:opacity-60"
                >
                  {busy === "retention" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Сохранить
                </button>
                <button
                  onClick={cleanup}
                  disabled={busy === "cleanup"}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200 disabled:opacity-60"
                >
                  {busy === "cleanup" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TimerReset className="w-3.5 h-3.5" />}
                  Запустить очистку
                </button>
              </div>

              {retention.last_run_at && (
                <p className="text-[10px] text-slate-500">
                  Последняя очистка: {formatDateTime(retention.last_run_at)}
                  {retention.last_result
                    ? ` · удалено ${retention.last_result.deleted_expired + retention.last_result.deleted_by_quota + retention.last_result.deleted_orphans} файлов`
                    : ""}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">Политика хранения недоступна</p>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Резервное копирование базы данных"
        subtitle={`Каталог: ${backupDir || "—"} · SQLite backup API или pg_dump для PostgreSQL`}
        icon={DatabaseBackup}
        actions={
          <button
            onClick={createBackup}
            disabled={busy === "backup"}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-[11px] text-white disabled:opacity-60"
          >
            {busy === "backup" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DatabaseBackup className="w-3.5 h-3.5" />}
            Создать копию
          </button>
        }
      >
        {backups.length === 0 ? (
          <p className="text-[11px] text-slate-500">Резервных копий пока нет — создайте первую перед обновлением.</p>
        ) : (
          <div className="space-y-1.5">
            {backups.map((item) => (
              <div
                key={item.filename}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-200 font-mono truncate">{item.filename}</p>
                  <p className="text-[9.5px] text-slate-500">
                    {formatDateTime(item.created_at)} · {formatBytes(item.size_bytes)}
                    {item.engine ? ` · ${item.engine}` : ""}
                  </p>
                </div>
                {restoreFor === item.filename ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={restoreWord}
                      onChange={(e) => setRestoreWord(e.target.value)}
                      placeholder="ВОССТАНОВИТЬ"
                      className="w-32 bg-slate-900 border border-red-500/40 rounded-lg px-2 py-1 text-[10px] text-slate-200"
                    />
                    <button
                      onClick={() => restore(item.filename)}
                      disabled={busy === "restore" || restoreWord.trim().toUpperCase() !== "ВОССТАНОВИТЬ"}
                      className="px-2 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-[10px] text-white disabled:opacity-40"
                    >
                      Подтвердить
                    </button>
                    <button
                      onClick={() => {
                        setRestoreFor(null);
                        setRestoreWord("");
                      }}
                      className="px-2 py-1 rounded-lg bg-slate-800 text-[10px] text-slate-300"
                    >
                      Отмена
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRestoreFor(item.filename)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-slate-200"
                  >
                    <ArchiveRestore className="w-3 h-3" /> Восстановить
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-slate-500 mt-3">
          Перед восстановлением автоматически создаётся страховочная копия текущей базы. Из CLI:
          <code className="font-mono text-slate-400"> python scripts/backup_db.py</code> и
          <code className="font-mono text-slate-400"> python scripts/restore_db.py --latest</code>.
        </p>
      </SectionCard>

      <SectionCard
        title="Telegram-уведомления"
        subtitle="Оружие — всем, бесхозные сумки — охране; кнопка подтверждения прямо в боте"
        icon={BellRing}
        actions={
          <button
            onClick={testTelegram}
            disabled={busy === "telegram"}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200 disabled:opacity-60"
          >
            {busy === "telegram" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Проверить связь
          </button>
        }
      >
        {notifications ? (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-3 gap-2.5">
              <label className="space-y-1">
                <span className="block text-[10px] uppercase text-slate-500">Токен бота</span>
                <input
                  value={notifications.bot_token ?? ""}
                  onChange={(e) => setNotifications({ ...notifications, bot_token: e.target.value })}
                  placeholder={notifications.bot_token_set ? "•••• сохранён" : "123456:AA..."}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] uppercase text-slate-500">Chat директора</span>
                <input
                  value={notifications.director_chat_id}
                  onChange={(e) => setNotifications({ ...notifications, director_chat_id: e.target.value })}
                  placeholder="-100..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] uppercase text-slate-500">Chat охраны</span>
                <input
                  value={notifications.guard_chat_id}
                  onChange={(e) => setNotifications({ ...notifications, guard_chat_id: e.target.value })}
                  placeholder="-100..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 font-mono"
                />
              </label>
            </div>

            <div className="grid sm:grid-cols-2 gap-1.5">
              <label className="inline-flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                <input
                  type="checkbox"
                  checked={notifications.enabled}
                  onChange={(e) => setNotifications({ ...notifications, enabled: e.target.checked })}
                  className="rounded accent-brand-500"
                />
                Уведомления включены
              </label>
              {TOGGLE_FIELDS.map(({ key, label }) => (
                <label
                  key={String(key)}
                  className="inline-flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(notifications[key])}
                    onChange={(e) => setNotifications({ ...notifications, [key]: e.target.checked })}
                    className="rounded accent-brand-500"
                  />
                  {label}
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[10px] text-slate-500 space-y-0.5">
                <p>
                  Статус: {notifications.status?.polling ? "бот слушает кнопки" : "бот не запущен"} · отправлено{" "}
                  {notifications.status?.sent_count ?? 0}
                </p>
                {notifications.last_error && <p className="text-amber-300">{notifications.last_error}</p>}
              </div>
              <button
                onClick={saveNotifications}
                disabled={busy === "notifications"}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-[11px] text-white disabled:opacity-60"
              >
                {busy === "notifications" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Сохранить
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">Настройки уведомлений недоступны</p>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SectionCard
          title="Экспорт моделей ONNX / TensorRT"
          subtitle="Готовые артефакты для инференса на CPU/GPU и Jetson"
          icon={PlayCircle}
        >
          <div className="space-y-2">
            {(exportsList?.items ?? []).map((item) => (
              <div
                key={item.filename}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-200 font-mono truncate">{item.filename}</p>
                  <p className="text-[9.5px] text-slate-500">
                    {item.size_mb} МБ · {formatDateTime(item.created_at)}
                  </p>
                </div>
                <a
                  href={api.mediaUrl(item.download_url)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-200 shrink-0"
                >
                  <Download className="w-3 h-3" /> Скачать
                </a>
              </div>
            ))}
            {(exportsList?.items ?? []).length === 0 && (
              <p className="text-[11px] text-slate-500">
                Артефактов нет. В разделе «Модели YOLO» выберите версию и нажмите «Экспорт ONNX» или «Экспорт TensorRT».
              </p>
            )}
          </div>
          {versions.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Версии весов</p>
              {versions.slice(0, 6).map((version) => (
                <div
                  key={version.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-200 truncate">
                      #{version.id} · {version.label}
                      {version.is_current && <span className="ml-1.5 text-[9px] text-emerald-300">боевая</span>}
                    </p>
                    <p className="text-[9.5px] text-slate-500 font-mono">
                      {version.architecture ?? "auto"} · mAP@50{" "}
                      {version.map50 !== null && version.map50 !== undefined ? version.map50.toFixed(2) : "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => exportVersion(version.id, "onnx")}
                      disabled={busy === `export-${version.id}-onnx`}
                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-200 disabled:opacity-50"
                    >
                      ONNX
                    </button>
                    <button
                      onClick={() => exportVersion(version.id, "engine")}
                      disabled={busy === `export-${version.id}-engine`}
                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-200 disabled:opacity-50"
                    >
                      TensorRT
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Метрики и мониторинг"
          subtitle="Prometheus + Sentry — наблюдаемость в проде"
          icon={Radio}
        >
          <div className="space-y-2 text-[11px] text-slate-300">
            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
              <span>Endpoint Prometheus</span>
              <a
                href={api.metricsUrl()}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sky-300 hover:text-sky-200"
              >
                /metrics ↗
              </a>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
              <span>Формат</span>
              <span className="text-slate-400">prometheus_client, text/plain</span>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
              <span>Sentry</span>
              <span className="text-slate-400">включается переменной SENTRY_DSN</span>
            </div>
            <p className="text-[10px] text-slate-500">
              Метрики: счётчики инцидентов и тревог, гистограмма инференса, состояние воркеров камер,
              очередь необработанных событий. Публичный <code className="font-mono">/metrics</code> отдаёт
              административный срез.
            </p>
          </div>
        </SectionCard>
      </div>

      {overview && overview.workers.length > 0 && (
        <SectionCard title="Загрузка воркеров" subtitle="FPS и возраст последнего кадра по камерам" icon={Clock4}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {overview.workers.map((worker) => (
              <div
                key={worker.camera_id}
                className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-200 truncate">{worker.name}</p>
                  <p className="text-[9.5px] text-slate-500">
                    {worker.profile} · вариант {worker.variant}
                  </p>
                </div>
                <span className={`text-[10px] font-mono ${worker.online ? "text-emerald-300" : "text-red-300"}`}>
                  {worker.fps.toFixed(0)} FPS
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-2.5">
        <AlertOctagon className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
        <p className="text-[10.5px] text-amber-100/80">
          Восстановление БД перезаписывает текущие данные и пересоздаёт соединения. Выполняйте его в окно
          обслуживания; после восстановления проверьте раздел «Пользователи» и журнал аудита.
        </p>
      </div>
    </div>
  );
};
