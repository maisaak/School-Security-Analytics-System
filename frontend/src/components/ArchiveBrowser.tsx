import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, Camera, Violation } from "../api/client";
import { VIOLATION_META } from "./ViolationsTable";
import { reviewLabels } from "./AlertCenter";
import { archiveRequest, emptyArchiveFilters, localIncidentDay, readArchivePresets } from "../utils/archiveState";
import { EvidenceImage } from "./EvidenceImage";

const empty = emptyArchiveFilters;
type Filters = typeof empty;
export function ArchiveBrowser({ cameras, storageKey, onOpenVideo, canExport, canReview = false, canDelete = false }: { cameras: Camera[]; storageKey: string; onOpenVideo: (row: Violation) => void; canExport: boolean; canReview?: boolean; canDelete?: boolean }) {
  const [filters, setFilters] = useState<Filters>(empty);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Violation[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [view, setView] = useState("cards");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const mutationLock = useRef(false);
  const lastQuery = useRef<unknown>(null);
  const busy = loading || mutating || exporting;
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1);
    window.addEventListener("incident-created", refresh); window.addEventListener("incident-updated", refresh);
    return () => { window.removeEventListener("incident-created", refresh); window.removeEventListener("incident-updated", refresh); };
  }, []);
  const changed = () => window.dispatchEvent(new Event("incident-updated"));
  const [presets, setPresets] = useState<Record<string, Filters>>(() => { try { return readArchivePresets(localStorage.getItem(storageKey + ":archive")); } catch { return {}; } });
  const query = useMemo(() => {
    try { return { params: archiveRequest(filters, page), error: "" }; }
    catch (e) { return { params: null, error: e instanceof Error ? e.message : "Проверьте фильтры" }; }
  }, [filters, page]);
  const params = query.params;
  useEffect(() => {
    if (!params) { setRows([]); setLoading(false); setSelected([]); return; }
    let cancelled = false; setLoading(true);
    if (lastQuery.current !== params) { setRows([]); setSelected([]); lastQuery.current = params; }
    api.getViolations(params).then(data => { if (!cancelled) { setRows(data); setSelected(ids => ids.filter(id => data.some(row => row.id === id))); setError(""); } }).catch(e => { if (!cancelled) { setRows([]); setSelected([]); setError(e instanceof Error ? e.message : "Ошибка архива"); } }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params, revision]);
  const change = (key: keyof Filters, value: string) => { setFilters(old => ({ ...old, [key]: value })); setPage(0); setSelected([]); };
  const exportRows = async (format: "csv" | "zip") => {
    if (!params || busy || exportLock.current) return;
    exportLock.current = true; setExporting(true); setError("");
    try { await api.exportArchive(params, format, selected.length ? selected : undefined); }
    catch (e) { setError(e instanceof Error ? e.message : "Ошибка экспорта"); }
    finally { exportLock.current = false; setExporting(false); }
  };
  return <section aria-labelledby="archive-heading"><h2 id="archive-heading">Архив инцидентов</h2><p>Верхняя граница времени не включается. Время указано в вашем часовом поясе.</p>
    <div className="operations-toolbar"><label>Камера<select value={filters.camera} onChange={e => change("camera", e.target.value)}><option value="">Все</option>{cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Тип<select value={filters.type} onChange={e => change("type", e.target.value)}><option value="">Все</option>{Object.entries(VIOLATION_META).map(([id, meta]) => <option key={id} value={id}>{meta.title}</option>)}</select></label><label>Статус<select value={filters.status} onChange={e => change("status", e.target.value)}><option value="">Все</option>{Object.entries(reviewLabels).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label><label>С<input type="datetime-local" value={filters.from} onChange={e => change("from", e.target.value)} /></label><label>До (не включая)<input type="datetime-local" value={filters.to} onChange={e => change("to", e.target.value)} /></label><label>Уверенность от, %<input type="number" min="0" max="100" value={filters.confidence} onChange={e => change("confidence", e.target.value)} /></label></div>
    <div className="operations-toolbar">
      <button disabled={!params} onClick={() => {
        const name = window.prompt("Название набора фильтров (до 80 символов)")?.trim();
        if (!name) return;
        if (name.length > 80 || (!Object.prototype.hasOwnProperty.call(presets, name) && Object.keys(presets).length >= 30)) { setError("До 30 наборов, название до 80 символов"); return; }
        const next = { ...presets, [name]: filters };
        try { localStorage.setItem(storageKey + ":archive", JSON.stringify(next)); setPresets(next); }
        catch { setError("Не удалось сохранить фильтры"); }
      }}>Сохранить фильтры</button>
      <select aria-label="Сохранённые фильтры" value="" onChange={e => { if (Object.prototype.hasOwnProperty.call(presets, e.target.value)) { setFilters(presets[e.target.value]); setPage(0); setSelected([]); } }}><option value="">Выбрать набор</option>{Object.keys(presets).map(name => <option key={name}>{name}</option>)}</select>
      <button aria-pressed={view === "cards"} onClick={() => setView("cards")}>Карточки</button>
      <button aria-pressed={view === "table"} onClick={() => setView("table")}>Список</button>
      <button aria-pressed={view === "timeline"} onClick={() => setView("timeline")}>Лента по дням</button>
      {canExport && (["csv", "zip"] as const).map(format => <button disabled={busy || !params} key={format} onClick={() => void exportRows(format)}>Экспорт {format.toUpperCase()} · {selected.length ? `выбрано ${selected.length}` : "по фильтрам"}</button>)}
    </div>
    {query.error && <p role="alert">{query.error}</p>}
    {error && <p role="alert">{error}</p>}<p role="status">{exporting ? "Готовим файл экспорта…" : busy ? "Загрузка…" : `Страница ${page + 1}: загружено ${rows.length} событий (не общее количество)`}</p>
    <button className="quiet-button" disabled={busy} onClick={() => setRevision(n => n + 1)}>Обновить архив</button>
    <div className={view === "cards" ? "archive-grid" : view === "timeline" ? "archive-timeline" : "archive-table"}>{rows.map((row, index) => <React.Fragment key={row.id}>
      {view === "timeline" && (index === 0 || localIncidentDay(rows[index - 1].detected_at) !== localIncidentDay(row.detected_at)) && <h3 className="archive-day">{localIncidentDay(row.detected_at)}</h3>}
      <article className="archive-card">
      <label><input type="checkbox" disabled={busy} checked={selected.includes(row.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, row.id].slice(0, 100) : ids.filter(id => id !== row.id))} /> Выбрать #{row.id}</label>
      <EvidenceImage loading="lazy" className="incident-preview" src={row.image_path} alt={`Кадр события ${row.id}`} />
      <h3>{VIOLATION_META[row.violation_type]?.title ?? row.violation_type}</h3><p>{row.camera_name} · {new Date(row.detected_at).toLocaleString()}</p><p>{reviewLabels[row.review_status]} · {(row.confidence * 100).toFixed(1)}%</p>
      <button className="quiet-button" onClick={() => onOpenVideo(row)}>Просмотр видеозаписи</button>
      {canReview && <form className="operations-toolbar" onSubmit={async event => {
        event.preventDefault(); if (mutationLock.current || loading) return; const data = new FormData(event.currentTarget); mutationLock.current = true; setMutating(true);
        try { await api.reviewViolation(row.id, String(data.get("status")) as Violation["review_status"], String(data.get("comment") || "")); changed(); }
        catch (e) { setError(e instanceof Error ? e.message : "Ошибка проверки"); } finally { mutationLock.current = false; setMutating(false); }
      }}><label>Статус<select name="status" defaultValue={row.review_status} key={row.review_status}>{Object.entries(reviewLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label><label>Комментарий<input name="comment" defaultValue={row.review_comment || ""} key={row.review_comment} maxLength={2000} /></label><button disabled={busy}>Сохранить проверку</button></form>}
      {canDelete && <button className="quiet-button" disabled={busy} onClick={async () => {
        if (mutationLock.current || loading || !window.confirm(`Удалить событие #${row.id} и его медиафайлы?`)) return; mutationLock.current = true; setMutating(true);
        try { await api.deleteViolation(row.id); changed(); } catch (e) { setError(e instanceof Error ? e.message : "Ошибка удаления"); } finally { mutationLock.current = false; setMutating(false); }
      }}>Удалить событие</button>}
    </article></React.Fragment>)}</div>
    {!busy && !rows.length && <p>Событий по выбранным фильтрам нет.</p>}<div className="operations-toolbar"><button disabled={busy || page === 0} onClick={() => setPage(n => n - 1)}>Назад</button><button disabled={busy || rows.length < 100} onClick={() => setPage(n => n + 1)}>Следующие 100</button><button onClick={() => { setFilters(empty); setPage(0); setSelected([]); }}>Сбросить фильтры</button></div>
  </section>;
}
