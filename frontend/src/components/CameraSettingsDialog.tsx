import { useEffect, useRef, useState } from "react";
import { Settings2, X } from "lucide-react";
import { api, Camera } from "../api/client";
import { CustomSelect } from "./CustomSelect";
import { CameraRulesEditor } from "./CameraRulesEditor";
import "../monitoring-features.css";

interface Props { camera: Camera; onClose: () => void; onSaved: () => void }
type Probe = { ok: boolean; latency_ms: number; width: number | null; height: number | null; preview_data_url: string | null; error_code?: string | null; message?: string };

export function CameraSettingsDialog({ camera, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(camera.name), [location, setLocation] = useState(camera.location);
  const [replaceSource, setReplaceSource] = useState(false), [protocol, setProtocol] = useState("rtsp"), [address, setAddress] = useState("");
  const [fps, setFps] = useState(camera.target_fps ?? 12), [quality, setQuality] = useState(camera.jpeg_quality ?? 82), [detectEvery, setDetectEvery] = useState(camera.detect_every ?? 3);
  const [busy, setBusy] = useState(false), [probeBusy, setProbeBusy] = useState(false), [error, setError] = useState<string | null>(null), [probe, setProbe] = useState<Probe | null>(null);
  const [tab, setTab] = useState<"connection" | "rules">("connection");
  const connectionDirty = name !== camera.name || location !== camera.location || replaceSource || fps !== (camera.target_fps ?? 12) || quality !== (camera.jpeg_quality ?? 82) || detectEvery !== (camera.detect_every ?? 3);
  const canLeaveRules = () => window.dispatchEvent(new Event("camera-rules-before-leave", { cancelable: true }));
  const close = () => {
    if (busy || probeBusy || !canLeaveRules()) return;
    if (connectionDirty && !window.confirm("Настройки подключения не сохранены. Закрыть без сохранения?")) return;
    onClose();
  };
  useEffect(() => {
    if (!connectionDirty && !busy && !probeBusy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [connectionDirty, busy, probeBusy]);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const probeSource = async () => {
    setProbeBusy(true); setError(null); setProbe(null);
    try {
      const result = replaceSource
        ? await api.probeCamera(protocol === "webcam" ? { rtsp_url: "webcam" } : { rtsp_url: protocol === "sim" ? `sim://${address.trim()}` : `${protocol}://${address.trim()}` })
        : await api.probeCamera({ camera_id: camera.id });
      setProbe(result);
      if (!result.ok) setError(result.message || `Источник недоступен${result.error_code ? ` (${result.error_code})` : ""}.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось проверить источник"); }
    finally { setProbeBusy(false); }
  };
  return <dialog ref={dialog} className="camera-settings-dialog" aria-labelledby="camera-settings-title" onCancel={event => { event.preventDefault(); close(); }} onClose={onClose}>
    <form onSubmit={async event => {
      event.preventDefault(); if (tab !== "connection" || busy || probeBusy) return; setBusy(true); setError(null);
      try { await api.updateCameraSettings(camera.id, { name, location, target_fps: fps, jpeg_quality: quality, detect_every: detectEvery, ...(replaceSource ? { rtsp_url: protocol === "webcam" ? "webcam" : protocol === "sim" ? `sim://${address.trim()}` : `${protocol}://${address.trim()}` } : {}) }); onSaved(); onClose(); }
      catch (err) { setError(err instanceof Error ? err.message : "Не удалось сохранить настройки"); } finally { setBusy(false); }
    }}>
      <div className="viewer-header"><div className="viewer-identity"><Settings2 size={24} aria-hidden="true" /><h3 id="camera-settings-title">Настройки камеры</h3></div><button className="viewer-close" type="button" disabled={busy || probeBusy} aria-label="Закрыть настройки камеры" onClick={close}><X size={20} aria-hidden="true" /></button></div>
      <div className="mf-tabs" role="group" aria-label="Раздел настроек камеры"><button type="button" disabled={busy || probeBusy} aria-pressed={tab === "connection"} onClick={() => { if (tab !== "connection" && canLeaveRules()) setTab("connection"); }}>Подключение</button><button type="button" disabled={busy || probeBusy} aria-pressed={tab === "rules"} onClick={() => setTab("rules")}>Зоны и расписание</button></div>
      {tab === "connection" ? <fieldset disabled={busy || probeBusy} className="camera-settings-fields">
        <div className="camera-settings-grid"><label>Название<input className="custom-input" required minLength={2} maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label>Расположение<input className="custom-input" maxLength={160} value={location} onChange={event => setLocation(event.target.value)} /></label></div>
        <div className="camera-connection-note"><strong>Текущее подключение</strong><code>{camera.rtsp_url}</code><p>Пароли и токены скрыты. Без замены подключения они сохранятся.</p></div>
        <label className="custom-check-row"><input type="checkbox" className="custom-checkbox" checked={replaceSource} onChange={event => { setReplaceSource(event.target.checked); setProbe(null); }} /><span>Заменить подключение и протокол</span></label>
        {replaceSource && <div className="camera-settings-grid"><label>Протокол<CustomSelect ariaLabel="Протокол подключения камеры" value={protocol} onChange={value => { setProtocol(String(value)); setProbe(null); }} options={[{ value: "rtsp", label: "RTSP" }, { value: "rtsps", label: "RTSPS" }, { value: "http", label: "HTTP" }, { value: "https", label: "HTTPS" }, { value: "sim", label: "Тестовый источник" }, { value: "webcam", label: "Веб-камера сервера" }]} /></label>{protocol !== "webcam" && <label>{protocol === "sim" ? "Стенд: entrance, hallway или courtyard" : "Адрес без префикса протокола"}<input className="custom-input" required autoComplete="off" spellCheck={false} maxLength={500} placeholder={protocol === "sim" ? "hallway" : "192.168.1.20:554/stream"} value={address} onChange={event => { setAddress(event.target.value); setProbe(null); }} /></label>}<p className="camera-setting-help">Доступные источники ограничены политикой сервера. HTTP и локальная веб-камера могут быть запрещены.</p></div>}
        <div className="mf-probe-actions"><button type="button" className="quiet-button" disabled={probeBusy || (replaceSource && protocol !== "webcam" && !address.trim())} onClick={probeSource}>{probeBusy ? "Проверяем…" : "Проверить источник"}</button><span>Проверка не сохраняет изменения.</span></div>
        {probe && <div className={`mf-probe ${probe.ok ? "is-ok" : "is-bad"}`} role="status"><strong>{probe.ok ? "Источник доступен" : "Источник недоступен"}</strong>{probe.ok && <><span>{probe.width} × {probe.height} · {probe.latency_ms} мс</span>{probe.preview_data_url && <img src={probe.preview_data_url} alt="Предпросмотр проверенного видеопотока" />}</>}{!probe.ok && <span>{probe.message || probe.error_code || "Попробуйте проверить параметры подключения."}</span>}</div>}
        <label>Целевой FPS обработки <strong>{fps}</strong><input className="modern-range" type="range" min={1} max={30} value={fps} onChange={event => setFps(Number(event.target.value))} /></label><p className="camera-setting-help">Ограничение серверной обработки, не изменение FPS самой камеры.</p>
        <label>Качество изображения MJPEG <strong>{quality}%</strong><input className="modern-range" type="range" min={40} max={95} value={quality} onChange={event => setQuality(Number(event.target.value))} /></label>
        <label>Частота детекции<CustomSelect ariaLabel="Частота детекции" value={detectEvery} onChange={setDetectEvery} options={[1, 2, 3, 5, 10].map(value => ({ value, label: value === 1 ? "Каждый кадр" : `Каждый ${value}-й кадр` }))} /></label>
      </fieldset> : <div className="mf-embedded-rules"><CameraRulesEditor camera={camera} /></div>}
      {error && <p role="alert" className="viewer-error">{error}</p>}
      {tab === "connection" && <div className="camera-settings-actions"><button type="button" className="quiet-button" disabled={busy || probeBusy} onClick={close}>Отмена</button><button className="accent-button" disabled={busy || probeBusy}>{busy ? "Применяем…" : "Сохранить и переподключить"}</button></div>}
    </form>
  </dialog>;
}
