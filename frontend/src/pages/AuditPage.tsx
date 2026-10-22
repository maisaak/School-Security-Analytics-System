import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { api, AuditEntry, AuditPage as AuditPageData, AuditSummary } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErrorNotice, formatDateTime, Pill, SectionCard, Spinner } from "../components/ui";

const OUTCOME_META: Record<string, { label: string; tone: "emerald" | "red" | "amber" }> = {
  success: { label: "успех", tone: "emerald" },
  denied: { label: "отказано", tone: "red" },
  failure: { label: "ошибка", tone: "amber" },
};

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Вход в систему",
  "auth.demo_login": "Быстрый вход по роли",
  "auth.logout": "Выход",
  "auth.login_failed": "Неудачный вход",
  "auth.login_blocked": "Вход в отключённую учётку",
  "access.denied": "Отказано в доступе",
  "camera.create": "Добавление камеры",
  "camera.delete": "Удаление камеры",
  "camera.toggle": "Пауза/возобновление камеры",
  "camera.simulate": "Тестовый сценарий",
  "violation.ack": "Подтверждение тревоги",
  "violation.delete": "Удаление улики",
  "violation.video_view": "Просмотр видео инцидента",
  "violation.video_download": "Скачивание видео инцидента",
  "media.analyze": "Проверка медиафайла",
  "model.retrain.start": "Запуск дообучения",
  "model.retrain.failed": "Ошибка дообучения",
  "model.version.promoted": "Версия принята Validation Gate",
  "model.version.rejected": "Версия отклонена Validation Gate",
  "model.rollback": "Откат версии весов",
  "user.create": "Создание пользователя",
  "user.update": "Изменение пользователя",
  "user.delete": "Удаление пользователя",
  "dataset.sample_upload": "Добавление примера в датасет",
  "audit.export": "Экспорт журнала аудита",
};

const PAGE_SIZE = 50;

export const AuditPage: React.FC = () => {
  const { can } = useAuth();
  const [data, setData] = useState<AuditPageData | null>(null);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [page, sum] = await Promise.all([
        api.getAudit({ action: action || undefined, outcome: outcome || undefined, search: search || undefined, limit: PAGE_SIZE, offset }),
        api.getAuditSummary(),
      ]);
      setData(page);
      setSummary(sum);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить журнал аудита");
    } finally {
      setLoading(false);
    }
  }, [action, outcome, search, offset]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-brand-400" />
            Полный журнал аудита
          </h2>
          <p className="text-[11px] text-slate-400">
            Все действия пользователей и системы. Логины, пароли и креды RTSP в журнале маскируются.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-[11px] text-slate-300 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Обновить
          </button>
          {can("audit:view") && (
            <a
              href={api.auditExportUrl}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-[11px] font-medium text-white transition"
            >
              <Download className="w-3.5 h-3.5" /> Экспорт CSV
            </a>
          )}
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Всего событий", value: summary.total, icon: Activity, tone: "text-brand-400" },
            { label: "За сегодня", value: summary.today, icon: ShieldCheck, tone: "text-emerald-400" },
            { label: "Отказов в доступе", value: summary.denied, icon: ShieldAlert, tone: "text-red-400" },
          ].map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 flex items-center gap-3">
              <Icon className={`w-5 h-5 ${tone}`} />
              <div>
                <p className="text-[11px] text-slate-400">{label}</p>
                <p className="text-xl font-bold text-ink">{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <SectionCard
        title="События"
        subtitle={data ? `Найдено ${data.total} записей` : undefined}
        icon={Filter}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setOffset(0);
              }}
              className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-brand-500 max-w-[210px]"
            >
              <option value="">Все действия</option>
              {(data?.actions ?? []).map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABELS[a] ?? a}
                </option>
              ))}
            </select>
            <select
              value={outcome}
              onChange={(e) => {
                setOutcome(e.target.value);
                setOffset(0);
              }}
              className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-brand-500"
            >
              <option value="">Любой исход</option>
              <option value="success">Успех</option>
              <option value="denied">Отказано</option>
              <option value="failure">Ошибка</option>
            </select>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              placeholder="Поиск по деталям…"
              className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 w-40 focus:outline-none focus:border-brand-500"
            />
          </div>
        }
      >
        {loading && !data ? (
          <Spinner label="Загрузка журнала…" />
        ) : (
          <>
            {error && <ErrorNotice message={error} onRetry={load} />}
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-left">
                <thead className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-2">Время</th>
                    <th className="py-2.5 px-2">Пользователь</th>
                    <th className="py-2.5 px-2">Роль</th>
                    <th className="py-2.5 px-2">Действие</th>
                    <th className="py-2.5 px-2">Объект</th>
                    <th className="py-2.5 px-2">Исход</th>
                    <th className="py-2.5 px-2">IP</th>
                    <th className="py-2.5 px-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {(data?.items ?? []).map((entry: AuditEntry) => {
                    const meta = OUTCOME_META[entry.outcome] ?? OUTCOME_META.success;
                    const isOpen = expanded === entry.id;
                    return (
                      <React.Fragment key={entry.id}>
                        <tr className="hover:bg-slate-800/40 transition align-top">
                          <td className="py-2.5 px-2 text-[10px] font-mono text-slate-400 whitespace-nowrap">
                            {formatDateTime(entry.created_at)}
                          </td>
                          <td className="py-2.5 px-2 text-[11px] text-slate-200 font-mono">
                            @{entry.actor_username ?? "system"}
                          </td>
                          <td className="py-2.5 px-2">
                            <Pill tone={entry.actor_role === "admin" ? "emerald" : entry.actor_role === "director" ? "sky" : entry.actor_role === "guard" ? "amber" : "slate"}>
                              {entry.actor_role ?? "system"}
                            </Pill>
                          </td>
                          <td className="py-2.5 px-2">
                            <p className="text-[11px] text-slate-200">{ACTION_LABELS[entry.action] ?? entry.action}</p>
                            <p className="text-[9px] font-mono text-slate-500">{entry.action}</p>
                          </td>
                          <td className="py-2.5 px-2 text-[10px] font-mono text-slate-400">
                            {entry.entity_type ? `${entry.entity_type}#${entry.entity_id ?? "—"}` : "—"}
                          </td>
                          <td className="py-2.5 px-2">
                            <Pill tone={meta.tone}>{meta.label}</Pill>
                          </td>
                          <td className="py-2.5 px-2 text-[10px] font-mono text-slate-500">
                            {entry.ip_address ?? "—"}
                          </td>
                          <td className="py-2.5 px-2 text-right">
                            {entry.detail && (
                              <button
                                onClick={() => setExpanded(isOpen ? null : entry.id)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition"
                                title="Детали события"
                              >
                                <ChevronDown className={`w-3.5 h-3.5 transition ${isOpen ? "rotate-180" : ""}`} />
                              </button>
                            )}
                          </td>
                        </tr>
                        {isOpen && entry.detail && (
                          <tr>
                            <td colSpan={8} className="px-2 pb-3">
                              <pre className="rounded-xl bg-slate-950 border border-slate-800 p-3 text-[10px] text-slate-300 overflow-x-auto whitespace-pre-wrap break-all font-mono">
                                {formatDetail(entry.detail)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {(data?.items.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-[11px] text-slate-500">
                        Событий по фильтру не найдено
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 mt-3">
              <p className="text-[10px] text-slate-500">
                Страница {currentPage} из {totalPages}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300 disabled:opacity-40 hover:bg-slate-800 transition"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Назад
                </button>
                <button
                  disabled={(data?.total ?? 0) <= offset + PAGE_SIZE}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300 disabled:opacity-40 hover:bg-slate-800 transition"
                >
                  Вперёд <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
};

function formatDetail(detail: string): string {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    return detail;
  }
}
