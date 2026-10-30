import { ArrowUpRight, Camera, Video, AlertTriangle, WifiOff } from "lucide-react";
import { DashboardStats } from "../api/client";

interface Props {
  stats: DashboardStats | null;
  onMonitoring: () => void;
}

export function SituationOverview({ stats, onMonitoring }: Props) {
  const online = stats?.by_camera.filter(camera => camera.online).length ?? 0;
  const offline = stats ? Math.max(0, stats.total_cameras - online) : 0;
  return <div className="situation-grid">
    <section className="monitor-launch">
      <div className="monitor-launch-copy"><Video size={30} aria-hidden="true" /><h3>Вся школа.<br />В одном поле зрения.</h3><p>Камеры, события и инструменты проверки — в рабочем пространстве поста охраны.</p><button className="accent-button" onClick={onMonitoring}>Открыть видеостену<ArrowUpRight size={18} aria-hidden="true" /></button></div>
      <div className="camera-topology" aria-label={stats ? `${online} камер на связи из ${stats.total_cameras}` : "Ожидание данных о камерах"}>
        <div className="topology-center"><Camera size={32} aria-hidden="true" /><strong>{stats ? online : "—"}<span> / {stats?.total_cameras ?? "—"}</span></strong><small>камер на связи</small></div>
      </div>
    </section>
    <section className="attention-panel"><div className="section-caption"><h3>Требует внимания</h3><AlertTriangle size={19} aria-hidden="true" /></div><div className="attention-row"><div><strong>{stats?.pending_violations ?? "—"}</strong><span>событий на проверке</span></div><button aria-label="Открыть камеры и журнал событий" onClick={onMonitoring}><ArrowUpRight aria-hidden="true" size={20} /></button></div><div className="attention-note"><WifiOff aria-hidden="true" size={18} /><span>{stats ? `Без связи: ${offline} из ${stats.total_cameras} камер` : "Данные камер ещё не загружены"}</span></div><p>Автоматическое срабатывание — повод проверить запись, а не подтверждение угрозы.</p></section>
    <section className="camera-directory"><div className="section-caption"><h3>Камеры объекта</h3><button onClick={onMonitoring}>Все камеры<ArrowUpRight size={16} aria-hidden="true" /></button></div><div className="camera-directory-list">{stats?.by_camera.slice(0, 6).map(camera => <button className="camera-directory-item" key={camera.id} onClick={onMonitoring}><span className="directory-camera-icon"><Camera size={20} aria-hidden="true" /></span><span><strong>{camera.name}</strong><small>{camera.location || "Расположение не указано"}</small></span><span className={`directory-status ${camera.online ? "is-online" : ""}`}>{camera.online ? "На связи" : "Нет связи"}</span></button>)}{!stats && <p className="directory-empty">Загружаем состояние камер…</p>}{stats && stats.by_camera.length === 0 && <p className="directory-empty">Камеры ещё не подключены. Откройте видеостену, чтобы добавить источник.</p>}</div></section>
  </div>;
}
