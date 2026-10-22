import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  Clock3,
  LogIn,
  LogOut,
  Plus,
  Users,
  X,
} from "lucide-react";
import { api, VisitorPass, VisitorSummary } from "../api/client";
import { ErrorNotice, Pill, SectionCard, Spinner } from "../components/ui";

const STATUS_META: Record<
  VisitorPass["status"],
  { label: string; tone: "emerald" | "amber" | "red" | "sky" | "slate" }
> = {
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

const formatDay = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
    : "—";

/**
 * Гостевые пропуска: регистрация посетителя, отметки входа/выхода,
 * срок действия и автоистечение. Модуль СКУД/турникетов в интерфейс не включён.
 */
export const VisitorsPage: React.FC = () => {
  const [visitors, setVisitors] = useState<VisitorPass[]>([]);
  const [summary, setSummary] = useState<VisitorSummary | null>(null);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    organization: "",
    purpose: "",
    host: "",
    phone: "",
    valid_hours: 4,
    notes: "",
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, summaryData] = await Promise.all([
        api.getVisitors({ status: filter || undefined, limit: 150 }),
        api.getVisitorSummary(),
      ]);
      setVisitors(list.items);
      setSummary(summaryData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить гостевые пропуска");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

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

  const createVisitor = () =>
    act("create", async () => {
      if (!form.full_name.trim()) throw new Error("Укажите ФИО посетителя");
      const pass = await api.createVisitor({ ...form, valid_hours: Number(form.valid_hours) || 4 });
      setShowCreate(false);
      setForm({ full_name: "", organization: "", purpose: "", host: "", phone: "", valid_hours: 4, notes: "" });
      return `Пропуск ${pass.badge_no} для ${pass.full_name} создан`;
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

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return visitors;
    return visitors.filter(
      (pass) =>
        pass.full_name.toLowerCase().includes(needle) ||
        pass.organization.toLowerCase().includes(needle) ||
        pass.badge_no.toLowerCase().includes(needle)
    );
  }, [visitors, search]);

  if (loading && !summary) return <Spinner label="Загружаем гостевые пропуска…" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
            <BadgeCheck className="w-5 h-5 text-sky-400" /> Гостевые пропуска
          </h2>
          <p className="text-[11px] text-slate-400">
            Регистрация посетителя, бейдж, срок действия, отметки входа и выхода
          </p>
        </div>
        <button
          onClick={() => setShowCreate((value) => !value)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-[11px] font-medium text-white"
        >
          <Plus className="w-3.5 h-3.5" /> Новый пропуск
        </button>
      </div>

      {error && <ErrorNotice message={error} onRetry={load} />}
      {notice && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
          {notice}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {[
            { label: "Внутри сейчас", value: summary.inside, sub: "по отметкам входа", icon: Users, tone: "text-emerald-300" },
            { label: "Ожидаются", value: summary.expected_today, sub: "пропуска на сегодня", icon: CalendarDays, tone: "text-sky-300" },
            { label: "Вышли сегодня", value: summary.left_today, sub: "закрытые визиты", icon: LogOut, tone: "text-slate-300" },
            { label: "Просрочены", value: summary.expired, sub: `нарушили срок: ${summary.overdue}`, icon: Clock3, tone: "text-amber-300" },
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
      )}

      {showCreate && (
        <SectionCard title="Новый гостевой пропуск" subtitle="Заполните данные посетителя" icon={Users}>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            <label className="space-y-1">
              <span className="block text-[10px] uppercase text-slate-500">ФИО *</span>
              <input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Иванов Иван Иванович"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[10px] uppercase text-slate-500">Организация</span>
              <input
                value={form.organization}
                onChange={(e) => setForm({ ...form, organization: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[10px] uppercase text-slate-500">Цель визита</span>
              <input
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                placeholder="Родительское собрание"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[10px] uppercase text-slate-500">Принимает</span>
              <input
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="Классный руководитель"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[10px] uppercase text-slate-500">Телефон</span>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[10px] uppercase text-slate-500">Действует, часов</span>
              <input
                type="number"
                min={1}
                max={72}
                value={form.valid_hours}
                onChange={(e) => setForm({ ...form, valid_hours: Number(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200"
              />
            </label>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={createVisitor}
              disabled={busy === "create"}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-[11px] text-white disabled:opacity-60"
            >
              <BadgeCheck className="w-3.5 h-3.5" />
              {busy === "create" ? "Создаём…" : "Создать пропуск"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300"
            >
              Отмена
            </button>
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Журнал пропусков"
        subtitle={`Всего: ${summary?.total ?? 0} · внутри: ${summary?.inside ?? 0}`}
        icon={BadgeCheck}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ФИО, организация, бейдж"
              className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[10.5px] text-slate-200 w-44"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-2 py-1.5 text-[10.5px] text-slate-200"
            >
              <option value="">Все статусы</option>
              <option value="expected">Ожидаются</option>
              <option value="inside">Внутри</option>
              <option value="left">Вышли</option>
              <option value="expired">Просрочены</option>
              <option value="cancelled">Отменены</option>
            </select>
          </div>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {visible.length === 0 && (
            <p className="text-[11px] text-slate-500 py-8 text-center lg:col-span-2">
              Пропусков нет — нажмите «Новый пропуск», чтобы зарегистрировать посетителя.
            </p>
          )}
          {visible.map((pass) => {
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
                  <span>
                    Бейдж: <span className="font-mono text-slate-200">{pass.badge_no}</span>
                  </span>
                  <span>Принимает: {pass.host || "—"}</span>
                  <span>
                    {formatDay(pass.valid_from)} → {formatDay(pass.valid_to)}
                  </span>
                  <span>Вход: {pass.checked_in_at ? formatTime(pass.checked_in_at) : "—"}</span>
                  <span>Выход: {pass.checked_out_at ? formatTime(pass.checked_out_at) : "—"}</span>
                  {pass.phone && <span className="font-mono">{pass.phone}</span>}
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
                    className="ml-auto text-[10px] text-slate-500 hover:text-red-300 disabled:opacity-40"
                  >
                    Удалить
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
};
