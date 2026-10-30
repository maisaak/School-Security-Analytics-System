import { useEffect, useRef, useState } from "react";
import { Camera, FloorPlan, api } from "../api/client";
import "../monitoring-features.css";

interface Props { cameras: Camera[]; isAdmin: boolean; onOpenCamera: (camera: Camera) => void }
type Placement = FloorPlan["placements"][number];

export function FloorPlans({ cameras, isAdmin, onOpenCamera }: Props) {
  const [plans, setPlans] = useState<FloorPlan[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [cameraId, setCameraId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Placement[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [imageReady, setImageReady] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const active = plans.find(plan => plan.id === selected);
  const selectedCamera = cameras.find(camera => camera.id === cameraId);

  useEffect(() => {
    let stopped = false;
    setLoading(true); setLoadFailed(false); setError(null);
    api.getFloorPlans().then(result => {
      if (stopped) return;
      setPlans(result); setSelected(result[0]?.id ?? ""); setDraft(result[0]?.placements ?? []);
    }).catch(e => { if (!stopped) { setLoadFailed(true); setError(e instanceof Error ? e.message : "Не удалось загрузить планы"); } })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [loadRevision]);

  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: Event) => {
      if (event.defaultPrevented) return;
      if (busy || !window.confirm("Расположение камер не сохранено. Покинуть план без сохранения?")) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("workspace-before-leave", navigate);
    return () => { window.removeEventListener("beforeunload", warn); window.removeEventListener("workspace-before-leave", navigate); };
  }, [dirty, busy]);

  const canDiscard = () => !dirty || window.confirm("Расположение камер не сохранено. Отменить изменения?");
  const choose = (id: string) => {
    if (!canDiscard()) return;
    setSelected(id); setDraft(plans.find(plan => plan.id === id)?.placements.map(p => ({ ...p })) ?? []);
    setDirty(false); if (id !== selected) { setImageReady(false); setImageFailed(false); } setError(null); setNotice("");
  };
  const place = (x: number, y: number) => {
    if (!isAdmin || !active || !selectedCamera || busy) return;
    setDraft(current => [...current.filter(p => p.camera_id !== cameraId), { camera_id: selectedCamera.id, x, y }]);
    setDirty(true); setNotice("");
  };
  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !name.trim() || !canDiscard()) return;
    setBusy(true); setError(null); setNotice("");
    try {
      const result = await api.uploadFloorPlan(name.trim(), file);
      setPlans(current => [...current, result]); setSelected(result.id); setDraft([]); setDirty(false); setImageReady(false); setImageFailed(false);
      setName(""); setFile(null); if (inputRef.current) inputRef.current.value = "";
      setNotice("План загружен. Выберите камеру и разместите её на изображении.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить план"); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!active) return;
    setBusy(true); setError(null);
    try {
      const result = await api.setFloorPlanPlacements(active.id, draft);
      setPlans(current => current.map(plan => plan.id === result.id ? result : plan));
      setDraft(result.placements); setDirty(false); setNotice("Расположение камер сохранено.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить расположение"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!active || !window.confirm(`Удалить план «${active.name}»? Камеры и архив останутся.`)) return;
    setBusy(true); setError(null);
    try {
      await api.deleteFloorPlan(active.id);
      const remaining = plans.filter(plan => plan.id !== active.id);
      setPlans(remaining); setSelected(remaining[0]?.id ?? ""); setDraft(remaining[0]?.placements ?? []);
      setDirty(false); setImageReady(false); setImageFailed(false); setNotice("План удалён. Камеры и архив сохранены.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось удалить план"); }
    finally { setBusy(false); }
  };
  const editCoordinate = (id: number, axis: "x" | "y", value: string) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    setDraft(current => current.map(p => p.camera_id === id ? { ...p, [axis]: Math.max(0, Math.min(100, number)) / 100 } : p));
    setDirty(true);
  };

  return <section className="mf-floorplans" aria-label="Планы этажей">
    <header className="mf-section-heading"><div><span className="mf-eyebrow">Камеры на плане</span><h2>Планы этажей</h2></div>
      {active && <label>Выбранный план<select className="custom-input" value={selected} disabled={busy} onChange={e => choose(e.target.value)}>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>}
    </header>
    {error && <p className="mf-error" role="alert">{error}</p>}
    {notice && <p className="mf-success" role="status">{notice}</p>}
    {loading && <p role="status">Загружаем планы…</p>}
    {loadFailed && <button type="button" className="quiet-button" onClick={() => setLoadRevision(value => value + 1)}>Повторить загрузку планов</button>}
    {isAdmin && <form className="mf-upload" onSubmit={upload}>
      <label>Название плана<input className="custom-input" value={name} disabled={busy} onChange={e => setName(e.target.value)} maxLength={120} required placeholder="Например, Первый этаж" /></label>
      <label>Изображение PNG или JPEG (до 5 МБ)<input ref={inputRef} className="custom-input" type="file" disabled={busy} accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={e => {
        const next = e.target.files?.[0] ?? null; setFile(null);
        if (next && (next.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(next.type))) { setError("Выберите PNG или JPEG размером не более 5 МБ."); e.target.value = ""; return; }
        setError(null); setFile(next);
      }} /></label>
      <button className="accent-button" disabled={busy || !file || loading || loadFailed}>{busy ? "Выполняем…" : "Загрузить план"}</button>
    </form>}
    {!loading && !loadFailed && !active && <div className="mf-empty-plan">{isAdmin ? "Загрузите изображение плана, чтобы расставить камеры." : "Планы этажей пока не добавлены."}</div>}
    {active && <>
      <p className="mf-plan-legend"><span>В сети</span><span>Не в сети / приостановлена</span><span>Срабатывание — требует проверки</span></p>
      {imageFailed && <div className="mf-error" role="status">Изображение плана недоступно. Черновик расположения сохранён в этой вкладке. <button type="button" className="quiet-button" disabled={busy} onClick={() => { setImageFailed(false); setImageAttempt(value => value + 1); }}>Повторить загрузку изображения</button></div>}
      <div className="mf-plan-layout"><div className="mf-plan-stage" onClick={event => {
        if (!imageReady || !imageRef.current) return;
        const rect = imageRef.current.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        place(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)));
      }}>
        <img key={`${active.id}:${imageAttempt}`} ref={imageRef} src={active.image_url} alt={`План этажа: ${active.name}`} onLoad={() => { setImageReady(true); setImageFailed(false); }} onError={() => { setImageReady(false); setImageFailed(true); }} />
        {imageReady && draft.map(marker => {
          const camera = cameras.find(item => item.id === marker.camera_id);
          const online = camera?.is_active && camera.online;
          const threat = online && !!camera?.active_threats.length;
          const status = threat ? "Срабатывание" : online ? "В сети" : "Нет активного потока";
          return <button type="button" className={`mf-camera-marker ${online ? "online" : "offline"} ${threat ? "threat" : ""}`} key={marker.camera_id} style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }} aria-label={`${camera?.name ?? "Удалённая камера"}. ${status}. Открыть видеопоток`} onClick={event => { event.stopPropagation(); if (camera) onOpenCamera(camera); }}><span aria-hidden="true" /><span className="mf-marker-label">{camera?.name ?? "Камера удалена"}{threat ? " · Тревога" : ""}</span></button>;
        })}
      </div>
      <aside className="mf-plan-controls">{isAdmin ? <fieldset disabled={busy} className="mf-plan-editor">
        <label>Камера для размещения<select className="custom-input" value={cameraId ?? ""} onChange={e => setCameraId(e.target.value ? Number(e.target.value) : null)}><option value="">Выберите камеру</option>{cameras.map(camera => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select></label>
        <p className="mf-muted">Нажмите на план или добавьте камеру в центр и задайте координаты. Нажатие на маркер открывает поток.</p>
        <button type="button" className="quiet-button" disabled={!selectedCamera || !imageReady} onClick={() => place(.5, .5)}>Разместить выбранную в центре</button>
        {draft.map(marker => { const camera = cameras.find(item => item.id === marker.camera_id); return <div className="mf-marker-edit" key={marker.camera_id}>
          <strong>{camera?.name ?? `Камера ${marker.camera_id}`}</strong>
          {(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()} (%)<input className="custom-input" aria-label={`${camera?.name ?? "Камера"} ${axis.toUpperCase()} в процентах`} type="number" min="0" max="100" step="0.1" value={(marker[axis] * 100).toFixed(1)} onChange={e => editCoordinate(marker.camera_id, axis, e.target.value)} /></label>)}
          <button type="button" className="quiet-button" onClick={() => { setDraft(current => current.filter(p => p.camera_id !== marker.camera_id)); setDirty(true); }}>Убрать</button>
        </div>; })}
        {dirty && <p role="status" className="mf-muted">Есть несохранённые изменения</p>}
        <button type="button" className="accent-button" disabled={!dirty} onClick={save}>Сохранить расположение</button>
        <button type="button" className="quiet-button" disabled={!dirty} onClick={() => choose(selected)}>Отменить изменения</button>
        <button type="button" className="quiet-button" onClick={remove}>Удалить план</button>
      </fieldset> : <p className="mf-muted">Выберите маркер для просмотра камеры. Срабатывание детектора не является подтверждённой угрозой.</p>}</aside></div>
    </>}
  </section>;
}
