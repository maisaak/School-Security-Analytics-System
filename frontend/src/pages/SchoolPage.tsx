import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  DoorOpen,
  Download,
  Filter,
  GraduationCap,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import {
  AccessEvent,
  AccessSummary,
  api,
  VisitorPass,
  VisitorSummary,
} from "../api/client";
import { ErrorNotice, formatDateTime, Pill, SectionCard, Spinner } from "../components/ui";

const KIND_LABEL: Record<string, string> = {
  student: "Ученик",
  teacher: "Учитель",
  staff: "Сотрудник",
  visitor: "Посетитель",
};

const STATUS_META: Record<VisitorPass["status"], { label: string; tone: "emerald" | "amber" | "red" | "sky" | "slate" }> = {
  expected: { label: "Ожидается", tone: "sky" },
  inside: { label: "Внутри", tone: "emerald" },
  left: { label: "Вышел", tone: "slate" },
  expired: { label: "Просрочен", tone: "amber" },
  cancelled: { label: "Отменён", tone: "red" },
};

const formatTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : "—";

export const SchoolPage: React.FC = () => {
  const [summary, setSummary] = useState<AccessSummary | null>(null);
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const [direction, setDirection] = useState("");
  const [kind, setKind] = useState("");
  const [lateOnly, setLateOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [visitors, setVisitors] = useState<VisitorPass[]>([]);
  const [visitorSummary, setVisitorSummary] = useState<VisitorSummary | null>(null);
  const [visitorFilter, setVisitorFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    organization: "",
    purpose: "",
    host: "",
    phone: "",
    valid_hours: 4,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  const loadAccess = useCallback(async () => {
    const [summaryData, pageData] = await Promise.all([
      api.getAccessSummary(date),
      api.getAccessEvents({
        date,
        direction: direction || undefined,
        kind: kind || undefined,
        late_only: lateOnly,
        search: search.trim() || undefined,
        limit: pageSize,
        offset: page * pageSize,
      }),
    ]);
    setSummary(summaryData);
    setEvents(pageData.items);
    setTotal(pageData.total);
  }, [date, direction, kind, lateOnly, search, page]);

  const loadVisitors = useCallback(async () => {
    const [list, summaryData] = await Promise.all([
      api.getVisitors({ status: visitorFilter || undefined, limit: 100 }),
      api.getVisitorSummary(),
    ]);
    setVisitors(list.items);
    setVisitorSummary(summaryData);
  }, [visitorFilter]);

  const load = useCallback(async () => {
    try {
      await Promise.all([loadAccess(), loadVisitors()]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить данные СКУД");
    } finally {
      setLoading(false);
    }
  }, [loadAccess, loadVisitors]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(0);
  }, [date, direction, kind, lateOnly, search]);

  const act = async (key: string, action: () => Promise<string>) => {
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

  const importFile = async (file: File) => {
    setBusy("import");
    setError(null);
    try {
      const result = await api.importAccessEvents(file);
      setNotice(
        `Импортировано проходов: ${result.created}${result.errors.length ? `, ошибок: ${result.errors.length}` : ""}`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Импорт не выполнен");
    } finally {
      setBusy(null);
    }
  };

  const createVisitor = () =>
    act("visitor", async () => {
      if (!form.full_name.trim()) throw new Error("Укажите ФИО посетителя");
      await api.createVisitor({ ...form, valid_hours: Number(form.valid_hours) || 4 });
      setShowCreate(false);
      setForm({ full_name: "", organization: "", purpose: "", host: "", phone: "", valid_hours: 4 });
      return "Гостевой пропуск создан";
    });

  const visitorAction = (pass: VisitorPass, action: "check-in" | "check-out" | "cancel") =>
    act(`visitor-${pass.id}`, async () => {
      await api.visitorAction(pass.id, action);
      return action === "check-in"
        ? `${pass.full_name}: вход отмечен`
        : action === "check-out"
        ? `${pass.full_name}: выход отмечен`
        : `Пропуск ${pass.badge_no} отменён`;
    });

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const maxHour = useMemo(() => Math.max(1, ...(summary?.hourly ?? [0])), [summary]);

  if (loading && !summary) return <Spinner label="Загружаем журнал СКУД…" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-sky-400" /> СКУД и посетители
          </h2>
          <p className="text-[11px] text-slate-400">
            Проходы через турникеты, опоздания к первому уроку и гостевые пропуска
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
            <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-slate-200 focus:outline-none"
            />
          </label>
          <button
            onClick={() => importRef.current?.click()}
            disabled={busy === "import"}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200 disabled:opacity-60"
          >
            {busy === "import" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Импорт CSV
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFile(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() =>
              act("simulate", async () => {
                const result = await api.simulateAccessEvents(18);
                return `Добавлено демонстрационных проходов: ${result.created}`;
              })
            }
            disabled={busy === "simulate"}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-[11px] text-white disabled:opacity-60"
          >
            {busy === "simulate" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Демо-проходы
          </button>
        </div>
      </div>

      {error && <ErrorNotice message={error} onRetry={load} />}
      {notice && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
          {notice}
        </div>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            {[
              { label: "Внутри сейчас", value: summary.inside_now, sub: "по данным турникетов", icon: Users, tone: "text-emerald-300" },
              { label: "Входы / выходы", value: `${summary.entries} / ${summary.exits}`, sub: `всего ${summary.events} проходов`, icon: DoorOpen, tone: "text-sky-300" },
              { label: "Опоздали", value: summary.late_students, sub: `первый урок в ${summary.school_start} (+${summary.late_grace_min} мин)`, icon: Clock3, tone: "text-amber-300" },
              { label: "Посетители внутри", value: visitorSummary?.inside ?? 0, sub: `${visitorSummary?.expected_today ?? 0} ожидается сегодня`, icon: UserCheck, tone: "text-brand-300" },
            ].map(({ label, value, sub, icon: Icon, tone }) => (
              <div key={label} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-400">{label}</p>
                  <p className="text-2xl font-bold text-ink mt-1">{value}</p>
                  <p className="text-[10px] text-slate-500 leading-snug">{sub}</p>
                </div>
                <div className={`p-2 rounded-xl border border-slate-700 bg-slate-800/50 shrink-0 ${tone}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <SectionCard title="Проходы по часам" subtitle={`${summary.date} · пик в ${String(summary.hourly.indexOf(maxHour)).padStart(2, "0")}:00`} icon={Clock3}>
              <div className="flex items-end gap-1 h-32">
                {summary.hourly.map((value, hour) => (
                  <div key={hour} className="flex-1 flex flex-col items-center gap-1" title={`${hour}:00 — ${value}`}>
                    <div className="w-full bg-slate-950 rounded-sm h-24 flex items-end border border-slate-800/70 overflow-hidden">
                      <div
                        className="w-full bg-gradient-to-t from-sky-600 to-sky-400"
                        style={{ height: `${value === 0 ? 3 : Math.max(8, (value / maxHour) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[8px] text-slate-500">{hour % 3 === 0 ? hour : ""}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {summary.turnstiles.map((item) => (
                  <Pill key={item.name} tone="slate">
                    {item.name}: {item.count}
                  </Pill>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Опоздания" subtitle="После звонка на первый урок" icon={ShieldAlert}>
              <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                {summary.late_list.length === 0 && <p className="text-[11px] text-slate-500">Опоздавших нет</p>}
                {summary.late_list.map((event) => (
                  <div key={event.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="min-w-0">
                      <p className="text-slate-200 truncate">{event.person_name}</p>
                      <p className="text-[9.5px] text-slate-500">
                        {event.class_name || KIND_LABEL[event.person_kind]} · {event.turnstile}
                      </p>
                    </div>
                    <span className="font-mono text-amber-300 shrink-0">{formatTime(event.occurred_at)}</span>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Состав потока" subtitle="Кто проходит через КПП" icon={Filter}>
              <div className="space-y-1.5">
                {Object.entries(summary.by_kind).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-slate-300">{KIND_LABEL[key] ?? key}</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-20 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-brand-500"
                          style={{ width: `${Math.min(100, (value / Math.max(1, summary.events)) * 100)}%` }}
                        />
                      </div>
                      <span className="font-mono text-slate-200 w-6 text-right">{value}</span>
                    </div>
                  </div>
                ))}
                {Object.keys(summary.by_kind).length === 0 && (
                  <p className="text-[11px] text-slate-500">Нет данных за выбранную дату</p>
                )}
              </div>
            </SectionCard>
          </div>
        </>
      )}

      <SectionCard
        title="Журнал проходов"
        subtitle="Фильтры по направлению, типу и опозданиям"
        icon={DoorOpen}
        actions={
          <a
            href={api.auditExportUrl}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10.5px] text-slate-200"
            title="Выгрузить журнал действий в CSV"
          >
            <Download className="w-3 h-3" /> CSV аудита
          </a>
        }
      >
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <label className="flex-1 min-w-[150px] space-y-1">
            <span className="block text-[10px] uppercase text-slate-500">Поиск по ФИО</span>
            <span className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Иванов"
                className="bg-transparent text-[11px] text-slate-200 focus:outline-none w-full"
              />
            </span>
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] uppercase text-slate-500">Направление</span>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200"
            >
              <option value="">Все</option>
              <option value="in">Вход</option>
              <option value="out">Выход</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] uppercase text-slate-500">Кто</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200"
            >
              <option value="">Все</option>
              <option value="student">Ученики</option>
              <option value="teacher">Учителя</option>
              <option value="staff">Сотрудники</option>
              <option value="visitor">Посетители</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={lateOnly}
              onChange={(e) => setLateOnly(e.target.checked)}
              className="rounded accent-amber-500"
            />
            Только опоздавшие
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-[9.5px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
              <tr>
                <th className="py-2 pr-2">Время</th>
                <th className="py-2 pr-2">ФИО</th>
                <th className="py-2 pr-2">Кто</th>
                <th className="py-2 pr-2">Класс</th>
                <th className="py-2 pr-2">Турникет</th>
                <th className="py-2 pr-2">Направление</th>
                <th className="py-2 pr-2">Источник</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {events.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500">
                    Проходов за выбранный день нет. Нажмите «Демо-проходы» или импортируйте CSV турникета.
                  </td>
                </tr>
              )}
              {events.map((event) => (
                <tr key={event.id} className="hover:bg-slate-800/30">
                  <td className="py-1.5 pr-2 font-mono text-slate-300">{formatTime(event.occurred_at)}</td>
                  <td className="py-1.5 pr-2">
                    <span className="text-slate-100">{event.person_name}</span>
                    {event.is_late && (
                      <span className="ml-1.5 text-[9px] text-amber-300 font-medium">опоздал</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 text-slate-300">{event.person_kind_label || KIND_LABEL[event.person_kind]}</td>
                  <td className="py-1.5 pr-2 text-slate-400">{event.class_name || "—"}</td>
                  <td className="py-1.5 pr-2 text-slate-400">{event.turnstile}</td>
                  <td className="py-1.5 pr-2">
                    <span
                      className={`inline-flex items-center gap-1 ${
                        event.direction === "in" ? "text-emerald-300" : "text-sky-300"
                      }`}
                    >
                      {event.direction === "in" ? <LogIn className="w-3 h-3" /> : <LogOut className="w-3 h-3" />}
                      {event.direction_label}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-slate-500">{event.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-2.5 mt-3">
          <span className="text-[10.5px] text-slate-500">Найдено {total} записей</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={page <= 0}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 text-[10.5px] text-slate-200 disabled:opacity-40"
            >
              <ChevronLeft className="w-3 h-3" /> Назад
            </button>
            <span className="text-[10.5px] text-slate-400 font-mono">
              {page + 1} / {pages}
            </span>
            <button
              onClick={() => setPage((value) => Math.min(pages - 1, value + 1))}
              disabled={page + 1 >= pages}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 text-[10.5px] text-slate-200 disabled:opacity-40"
            >
              Вперёд <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Гостевые пропуска"
        subtitle="Регистрация, вход/выход и автоматическое истечение срока"
        icon={BadgeCheck}
        actions={
          <div className="flex items-center gap-1.5">
            <select
              value={visitorFilter}
              onChange={(e) => setVisitorFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5 text-[10.5px] text-slate-200"
            >
              <option value="">Все статусы</option>
              <option value="expected">Ожидаются</option>
              <option value="inside">Внутри</option>
              <option value="left">Вышли</option>
              <option value="expired">Просрочены</option>
              <option value="cancelled">Отменены</option>
            </select>
            <button
              onClick={() => setShowCreate((value) => !value)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-[10.5px] text-white"
            >
              <Plus className="w-3 h-3" /> Пропуск
            </button>
          </div>
        }
      >
        {showCreate && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 mb-3 space-y-2">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              <label className="space-y-0.5">
                <span className="block text-[9.5px] uppercase text-slate-500">ФИО *</span>
                <input
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-200"
                />
              </label>
              <label className="space-y-0.5">
                <span className="block text-[9.5px] uppercase text-slate-500">Организация</span>
                <input
                  value={form.organization}
                  onChange={(e) => setForm({ ...form, organization: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-200"
                />
              </label>
              <label className="space-y-0.5">
                <span className="block text-[9.5px] uppercase text-slate-500">Цель визита</span>
                <input
                  value={form.purpose}
                  onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                  placeholder="Родительское собрание"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-200"
                />
              </label>
              <label className="space-y-0.5">
                <span className="block text-[9.5px] uppercase text-slate-500">Принимает</span>
                <input
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-200"
                />
              </label>
              <label className="space-y-0.5">
                <span className="block text-[9.5px] uppercase text-slate-500">Телефон</span>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-200"
                />
              </label>
              <label className="space-y-0.5">
                <span className="block text-[9.5px] uppercase text-slate-500">Действует, часов</span>
                <input
                  type="number"
                  min={1}
                  max={72}
                  value={form.valid_hours}
                  onChange={(e) => setForm({ ...form, valid_hours: Number(e.target.value) })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-200"
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={createVisitor}
                disabled={busy === "visitor"}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[11px] text-white disabled:opacity-60"
              >
                {busy === "visitor" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BadgeCheck className="w-3.5 h-3.5" />}
                Создать пропуск
              </button>
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded-lg bg-slate-800 text-[11px] text-slate-300">
                Отмена
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {visitors.length === 0 && (
            <p className="text-[11px] text-slate-500 py-6 text-center lg:col-span-2">
              Пропусков нет — создайте гостевой пропуск или импортируйте журнал турникета.
            </p>
          )}
          {visitors.map((pass) => {
            const meta = STATUS_META[pass.status] ?? STATUS_META.expected;
            return (
              <div key={pass.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11.5px] font-medium text-ink truncate">{pass.full_name}</p>
                    <p className="text-[10px] text-slate-500 truncate">
                      {pass.organization || "—"} · {pass.purpose || "без цели"}
                    </p>
                  </div>
                  <Pill tone={meta.tone}>{meta.label}</Pill>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
                  <span>Пропуск: <span className="font-mono text-slate-200">{pass.badge_no}</span></span>
                  <span>Принимает: {pass.host || "—"}</span>
                  <span>До: {formatTime(pass.valid_to)}</span>
                  <span>
                    Вход: {pass.checked_in_at ? formatTime(pass.checked_in_at) : "—"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {pass.status === "expected" && (
                    <button
                      onClick={() => visitorAction(pass, "check-in")}
                      disabled={busy === `visitor-${pass.id}`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[10px] text-white disabled:opacity-50"
                    >
                      <LogIn className="w-3 h-3" /> Вход
                    </button>
                  )}
                  {pass.status === "inside" && (
                    <button
                      onClick={() => visitorAction(pass, "check-out")}
                      disabled={busy === `visitor-${pass.id}`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-[10px] text-white disabled:opacity-50"
                    >
                      <LogOut className="w-3 h-3" /> Выход
                    </button>
                  )}
                  {(pass.status === "expected" || pass.status === "inside") && (
                    <button
                      onClick={() => visitorAction(pass, "cancel")}
                      disabled={busy === `visitor-${pass.id}`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 disabled:opacity-50"
                    >
                      <X className="w-3 h-3" /> Отменить
                    </button>
                  )}
                  <button
                    onClick={() =>
                      act(`del-${pass.id}`, async () => {
                        await api.deleteVisitor(pass.id);
                        return `Пропуск ${pass.badge_no} удалён`;
                      })
                    }
                    disabled={busy === `del-${pass.id}`}
                    className="ml-auto p-1.5 rounded-lg text-slate-500 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                    title="Удалить запись"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {visitorSummary && (
          <p className="text-[10px] text-slate-500 mt-3">
            Всего пропусков: {visitorSummary.total} · внутри: {visitorSummary.inside} · вышли сегодня:{" "}
            {visitorSummary.left_today} · просрочено: {visitorSummary.expired} · нарушили срок:{" "}
            {visitorSummary.overdue}
          </p>
        )}
      </SectionCard>
    </div>
  );
};
