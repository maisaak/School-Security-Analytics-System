import { useEffect, useState } from "react";
import { Camera, DetectionRules, api } from "../api/client";
import "../monitoring-features.css";

const emptyRules = (): DetectionRules => ({ enabled_classes: [], zones: [], schedule: { enabled: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", windows: [{ weekdays: [0, 1, 2, 3, 4], start: "08:00", end: "17:00" }] } });
const classes: Array<[DetectionRules["enabled_classes"][number], string]> = [["weapon", "Оружие"], ["suspicious_bag", "Оставленная сумка"], ["dog", "Собака"]];
export function CameraRulesEditor({ camera }: { camera: Camera }) {
  const [rules, setRules] = useState<DetectionRules>(emptyRules), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null), [message, setMessage] = useState("");
  const [zoneName, setZoneName] = useState("Зона 1"), [zoneMode, setZoneMode] = useState<"include" | "exclude">("include"), [points, setPoints] = useState<Array<[number, number]>>([]), [imageLoaded, setImageLoaded] = useState(false);
  const [loadedRules, setLoadedRules] = useState(false);
  const [baseline, setBaseline] = useState("");
  const dirty = loadedRules && (JSON.stringify(rules) !== baseline || points.length > 0);
  useEffect(() => {
    const leave = (event: Event) => {
      if (event.defaultPrevented) return;
      if (saving || (dirty && !window.confirm("Правила или черновик зоны не сохранены. Отменить изменения?"))) event.preventDefault();
    };
    const unload = (event: BeforeUnloadEvent) => { if (dirty || saving) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("camera-rules-before-leave", leave);
    window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("camera-rules-before-leave", leave); window.removeEventListener("beforeunload", unload); };
  }, [dirty, saving]);
  useEffect(() => { let active = true; setLoading(true); setError(null); setLoadedRules(false); setPoints([]); setImageLoaded(false); api.getCameraRules(camera.id).then(value => { if (active) { setRules(value); setBaseline(JSON.stringify(value)); setLoadedRules(true); } }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Не удалось загрузить правила камеры"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [camera.id]);
  const updateWindow = (index: number, changes: Partial<DetectionRules["schedule"]["windows"][number]>) => setRules(current => ({ ...current, schedule: { ...current.schedule, windows: current.schedule.windows.map((window, i) => i === index ? { ...window, ...changes } : window) } }));
  const save = async () => { if (!loadedRules || saving) return; if (points.length) { setError("Добавьте нарисованную зону или очистите её черновик перед сохранением."); return; } setSaving(true); setError(null); setMessage(""); try { const result = await api.setCameraRules(camera.id, rules); setRules(result); setBaseline(JSON.stringify(result)); setMessage("Правила сохранены."); } catch (err) { setError(err instanceof Error ? err.message : "Не удалось сохранить правила"); } finally { setSaving(false); } };
  const imagePoint = (event: React.MouseEvent<HTMLDivElement>) => { if (!imageLoaded || saving) return; const rect = event.currentTarget.getBoundingClientRect(); if (!rect.width || !rect.height) return; setPoints(current => current.length >= 64 ? current : [...current, [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))]]); };
  if (loading) return <p className="mf-muted" role="status">Загружаем правила…</p>;
  if (!loadedRules) return <p className="mf-error" role="alert">{error || "Правила недоступны"}. Закройте настройки и повторите загрузку.</p>;
  return <section className="mf-rules" aria-label={`Правила детекции камеры ${camera.name}`}>
    <fieldset className="mf-rules-content" disabled={saving}>
    <header className="mf-section-heading"><div><span className="mf-eyebrow">Настройка детекции</span><h4>Зоны и расписание</h4></div><button type="button" className="accent-button" disabled={saving} onClick={save}>{saving ? "Сохраняем…" : "Сохранить правила"}</button></header>
    {error && <p className="mf-error" role="alert">{error}</p>}{message && <p className="mf-success" role="status">{message}</p>}
    <fieldset className="mf-fieldset" disabled={saving}><legend>Классы для обнаружения</legend><div className="mf-class-grid">{classes.map(([value, label]) => <label key={value} className="mf-check"><input type="checkbox" checked={rules.enabled_classes.includes(value)} onChange={event => setRules(current => ({ ...current, enabled_classes: event.target.checked ? [...current.enabled_classes, value] : current.enabled_classes.filter(item => item !== value) }))} /><span>{label}</span></label>)}</div></fieldset>
    <div className="mf-zone-layout"><div className="mf-image-stage" onClick={imagePoint} role="button" tabIndex={0} aria-disabled={!imageLoaded || saving} aria-label="Видеокадр для рисования зоны. Enter добавляет вершину в центр; координаты можно изменить в списке." onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (imageLoaded && !saving) setPoints(current => current.length >= 64 ? current : [...current, [.5, .5]]); } }}>
      {camera.online && camera.is_active ? <img src={`/api/cameras/${camera.id}/stream`} alt="Кадр камеры для разметки зон" onLoad={() => setImageLoaded(true)} onError={() => setImageLoaded(false)} /> : <div className="mf-no-frame"><strong>Кадр недоступен</strong><span>Камера должна передавать изображение, чтобы рисовать зоны.</span></div>}
      {imageLoaded && <svg className="mf-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">{rules.zones.map(zone => <polygon key={zone.id} points={zone.points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")} className={zone.mode === "exclude" ? "mf-polygon exclude" : "mf-polygon"} />)}{points.length > 0 && <><polyline points={points.map(([x,y]) => `${x*1000},${y*1000}`).join(" ")} className="mf-draft-line" />{points.map(([x,y],i) => <circle key={i} cx={x*1000} cy={y*1000} r="9" className="mf-draft-point" />)}</>}</svg>}
      <span className="mf-image-caption">Нажмите по кадру, чтобы добавить вершину</span>
    </div><div className="mf-zone-controls"><label>Название новой зоны<input className="custom-input" value={zoneName} maxLength={80} onChange={event => setZoneName(event.target.value)} /></label><label>Тип зоны<select className="custom-input" value={zoneMode} onChange={event => setZoneMode(event.target.value as "include" | "exclude")}><option value="include">Включающая</option><option value="exclude">Исключающая</option></select></label>
      <div className="mf-coordinate-list"><strong>Вершины черновика ({points.length})</strong>{points.map(([x,y],i) => <div className="mf-coordinate" key={i}><span>Точка {i+1}</span><label>X<input aria-label={`Точка ${i+1}, X (0–100)`} type="number" min="0" max="100" step="0.1" value={(x*100).toFixed(1)} onChange={e => setPoints(list => list.map((p,j) => j===i ? [Math.max(0,Math.min(1,Number(e.target.value)/100)),p[1]] : p))} /></label><label>Y<input aria-label={`Точка ${i+1}, Y (0–100)`} type="number" min="0" max="100" step="0.1" value={(y*100).toFixed(1)} onChange={e => setPoints(list => list.map((p,j) => j===i ? [p[0],Math.max(0,Math.min(1,Number(e.target.value)/100))] : p))} /></label></div>)}</div>
      <div className="mf-inline-actions"><button type="button" className="quiet-button" onClick={() => setPoints(list => list.slice(0,-1))} disabled={!points.length}>Удалить последнюю</button><button type="button" className="quiet-button" onClick={() => setPoints([])} disabled={!points.length}>Очистить черновик</button></div>
      <button type="button" className="accent-button" disabled={points.length < 3 || !zoneName.trim() || !imageLoaded} onClick={() => { setRules(current => ({ ...current, zones: [...current.zones, { id: crypto.randomUUID(), name: zoneName.trim(), mode: zoneMode, points: points.map(p => [p[0],p[1]] as [number,number]) }] })); setPoints([]); }}>Добавить зону</button>
    </div></div>
    <p className="mf-muted">Координаты нормированы по кадру (0–100%). Объект считается внутри зоны, если центр его рамки обнаружения попадает в неё. Если точки включающей зоны пересекаются с исключающей — исключение имеет приоритет.</p>
    <div className="mf-saved-zones">{rules.zones.map(zone => <article className="mf-saved-zone" key={zone.id}><span className={`mf-zone-swatch ${zone.mode}`} /><div><strong>{zone.name}</strong><small>{zone.mode === "include" ? "Включающая" : "Исключающая"} · {zone.points.length} вершин</small></div><button type="button" className="quiet-button" aria-label={`Удалить зону ${zone.name}`} onClick={() => setRules(current => ({ ...current, zones: current.zones.filter(item => item.id !== zone.id) }))}>Удалить</button></article>)}</div>
    <fieldset className="mf-fieldset" disabled={saving}>
      <legend>Расписание</legend>
      <label className="mf-check"><input type="checkbox" checked={rules.schedule.enabled} onChange={event => setRules(current => ({ ...current, schedule: { ...current.schedule, enabled: event.target.checked } }))} /><span>Включить расписание детекции</span></label>
      {rules.schedule.enabled && <>
        <label className="mf-timezone">Часовой пояс IANA<input className="custom-input" value={rules.schedule.timezone} onChange={event => setRules(current => ({ ...current, schedule: { ...current.schedule, timezone: event.target.value } }))} placeholder="Europe/Moscow" /></label>
        {rules.schedule.windows.map((window, index) => <div className="mf-window" key={index}>
          <div className="mf-weekdays" aria-label={`Дни недели окна ${index + 1}`}>
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day, weekday) => <label key={day}><input type="checkbox" aria-label={day} checked={window.weekdays.includes(weekday)} onChange={event => updateWindow(index, { weekdays: event.target.checked ? [...window.weekdays, weekday].sort() : window.weekdays.filter(d => d !== weekday) })} />{day}</label>)}
          </div>
          <label>С <input className="custom-input" type="time" value={window.start} onChange={event => updateWindow(index, { start: event.target.value })} /></label>
          <label>До <input className="custom-input" type="time" value={window.end} onChange={event => updateWindow(index, { end: event.target.value })} /></label>
          <button type="button" className="quiet-button" aria-label={`Удалить окно расписания ${index + 1}`} onClick={() => setRules(current => ({ ...current, schedule: { ...current.schedule, windows: current.schedule.windows.filter((_, i) => i !== index) } }))}>Удалить</button>
        </div>)}
        <button type="button" className="quiet-button" onClick={() => setRules(current => ({ ...current, schedule: { ...current.schedule, windows: [...current.schedule.windows, { weekdays: [0, 1, 2, 3, 4], start: "08:00", end: "17:00" }] } }))}>Добавить временное окно</button>
      </>}
    </fieldset>
    {dirty && <p className="mf-muted" role="status">Есть несохранённые правила или черновик зоны</p>}
    <div className="mf-save-bottom"><button type="button" className="accent-button" disabled={saving} onClick={save}>{saving ? "Сохраняем…" : "Сохранить правила"}</button></div>
    </fieldset>
  </section>;
}
