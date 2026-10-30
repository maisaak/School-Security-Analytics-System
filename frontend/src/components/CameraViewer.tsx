import { useEffect, useRef, useState } from "react";
import { Activity, Camera as CameraIcon, MapPin, Pause, X } from "lucide-react";
import type { Camera } from "../api/client";

interface Props { camera: Camera; onClose: () => void }

export function CameraViewer({ camera, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [streamFailed, setStreamFailed] = useState(false);
  const [streamRevision, setStreamRevision] = useState(0);
  useEffect(() => { setStreamFailed(false); }, [camera.id, camera.is_active]);
  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  const status = !camera.is_active ? "Поток приостановлен" : !camera.online ? "Нет связи" : "На связи";
  return <dialog ref={dialog} className="camera-viewer" aria-labelledby="camera-viewer-title" onClose={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
  }}>
    <header className="viewer-header"><div className="viewer-identity"><span className="viewer-camera-icon"><CameraIcon aria-hidden="true" size={22} /></span><div><h3 id="camera-viewer-title">{camera.name}</h3><p><MapPin size={13} aria-hidden="true" />{camera.location || "Расположение не указано"}</p></div></div><button autoFocus type="button" className="viewer-close" aria-label="Закрыть просмотр камеры" onClick={() => dialog.current?.close()}><X size={21} aria-hidden="true" /></button></header>
    <div className="viewer-screen">{camera.is_active ? streamFailed ? <div className="viewer-paused" role="status"><CameraIcon size={40} aria-hidden="true" /><p>Не удалось получить видеопоток</p><button type="button" className="quiet-button" onClick={() => { setStreamFailed(false); setStreamRevision(value => value + 1); }}>Повторить подключение</button></div> : <img key={`${camera.id}:${streamRevision}`} src={`/api/cameras/${camera.id}/stream?attempt=${streamRevision}`} alt={`Видеопоток камеры ${camera.name}`} onError={() => setStreamFailed(true)} /> : <div className="viewer-paused"><Pause size={40} aria-hidden="true" /><p>Поток приостановлен оператором</p></div>}<span className={`viewer-status ${camera.is_active && camera.online && !streamFailed ? "is-online" : ""}`}>{streamFailed && camera.is_active ? "Ошибка просмотра" : status}</span></div>
    <footer className="viewer-footer"><span><Activity size={16} aria-hidden="true" />{camera.is_active && camera.online ? `${camera.fps.toFixed(0)} FPS` : "FPS недоступен"}</span><span>{camera.is_active && camera.online ? `Задержка ${camera.latency_ms.toFixed(0)} мс` : "Ожидание потока"}</span><span>{camera.is_simulated ? "Тестовый источник" : "Камера объекта"}</span><small>Esc — закрыть</small></footer>
    {camera.last_error && <p role="status" className="viewer-error">{camera.last_error}</p>}
    {camera.is_active && camera.online && camera.active_threats.length > 0 && <p className="viewer-threat">В кадре обнаружено срабатывание детектора. Проверьте видео и журнал событий.</p>}
  </dialog>;
}
