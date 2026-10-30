import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, User, Violation } from "../api/client";
import { VIOLATION_META } from "./ViolationsTable";
import "../operations.css";
import { createIncidentTracker } from "../utils/incidentFeed";
import { EvidenceImage } from "./EvidenceImage";

export const reviewLabels: Record<Violation["review_status"], string> = { new: "Новое", in_review: "На проверке", confirmed: "Подтверждено человеком", false_alarm: "Ложная тревога", closed: "Закрыто" };

export function AlertCenter({ user }: { user: User }) {
  const [items, setItems] = useState<Violation[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const reviewLock = useRef(false);
  const [fullscreenHost, setFullscreenHost] = useState<Element | null>(null);
  useEffect(() => {
    const sync = () => { dialog.current?.close(); setFullscreenHost(document.fullscreenElement); };
    sync(); document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const canReview = user.role === "admin" || user.permissions?.includes("review_incidents");
  useEffect(() => {
    let stopped = false, running = false, queued = false;
    const track = createIncidentTracker();
    const poll = async () => {
      if (running) { queued = true; return; }
      running = true;
      try {
        const rows = await api.getViolations({ limit: 100, unacknowledged_only: false });
        if (stopped) return;
        const fresh = track(rows);
        setItems(rows); setError(""); setLastSync(new Date());
        fresh.forEach(row => window.dispatchEvent(new CustomEvent("incident-created", { detail: row })));
      } catch (e) { if (!stopped) setError(e instanceof Error ? e.message : "Ошибка загрузки тревог"); }
      finally { running = false; if (queued && !stopped) { queued = false; void poll(); } }
    };
    void poll(); const timer = window.setInterval(poll, 5000);
    window.addEventListener("incident-updated", poll);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener("incident-updated", poll); };
  }, [user.id, user.username]);
  const incident = items.find(row => row.id === selected);
  const review = async (status: Violation["review_status"]) => {
    if (!incident || reviewLock.current) return;
    reviewLock.current = true; setBusy(true);
    try {
      const updated = await api.reviewViolation(incident.id, status, comment);
      setItems(rows => rows.map(row => row.id === updated.id ? updated : row));
      window.dispatchEvent(new Event("incident-updated"));
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка проверки"); }
    finally { reviewLock.current = false; setBusy(false); }
  };
  const content = <><button className="alert-center-launch quiet-button" title="Новые статусы среди последних 100 событий, не общее число в архиве" onClick={() => dialog.current?.showModal()}>Центр тревог · {items.filter(row => row.review_status === "new").length}{error ? " · нет обновления" : ""}</button>
    <dialog ref={dialog} className="operations-dialog" aria-labelledby="alert-center-title">
      <header><h2 id="alert-center-title">Центр тревог</h2><button onClick={() => dialog.current?.close()} aria-label="Закрыть центр тревог">Закрыть</button></header>
      <p>Последние 100 событий · обновление каждые 5 секунд. При большом потоке событий проверяйте архив: этот список не гарантирует доставку всех тревог. Срабатывания детектора требуют проверки человеком.</p>
      <p className="alert-sync-status">{lastSync ? `Последнее успешное обновление: ${lastSync.toLocaleTimeString("ru-RU")}${error ? " · данные могут быть устаревшими" : ""}` : "Ожидаем первое обновление…"}</p>
      {error && <p role="alert">{error}</p>}
      <div className="alert-center-layout"><div>{items.length === 0 && <p>Событий пока нет</p>}{items.map(row => <button disabled={busy} className="incident-list-row" key={row.id} aria-pressed={selected === row.id} onClick={() => { setSelected(row.id); setComment(row.review_comment || ""); }}><strong>{VIOLATION_META[row.violation_type]?.title ?? row.violation_type}</strong><span>{row.camera_name} · {new Date(row.detected_at).toLocaleString()}</span><span>{reviewLabels[row.review_status]}</span></button>)}</div>
      {incident && <section><h3>{incident.camera_name} · {incident.camera_location}</h3><p>{new Date(incident.detected_at).toLocaleString()} · Уверенность {(incident.confidence * 100).toFixed(1)}%</p><EvidenceImage key={incident.id} className="incident-preview" src={incident.image_path} alt="Кадр срабатывания для проверки" /><p>{reviewLabels[incident.review_status]}</p>{canReview && <><label>Комментарий проверяющего<textarea disabled={busy} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} /></label><div className="operations-toolbar">{Object.entries(reviewLabels).map(([status, label]) => <button key={status} disabled={busy} onClick={() => void review(status as Violation["review_status"])}>{label}</button>)}</div></>}</section>}</div>
    </dialog></>;
  return fullscreenHost ? createPortal(content, fullscreenHost) : content;
}
