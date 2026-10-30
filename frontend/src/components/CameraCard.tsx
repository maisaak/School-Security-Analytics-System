import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Pause, Play, RefreshCw, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { Camera } from "../api/client";

interface CameraCardProps {
  camera: Camera;
  canManage: boolean;
  onToggle: (id: number) => void;
  onReconnect: (id: number) => void;
  onDelete: (id: number) => void;
  onSimulate: (
    id: number,
    scenario: "suspicious_bag" | "dog" | "weapon" | "person_with_bag"
  ) => void;
  onExpand: (camera: Camera) => void;
  onSettings?: (camera: Camera) => void;
}

export const CameraCard: React.FC<CameraCardProps> = ({
  camera,
  canManage,
  onToggle,
  onReconnect,
  onDelete,
  onSimulate,
  onExpand,
  onSettings,
}) => {
  const hasThreat = camera.is_active && camera.online && camera.active_threats.length > 0;
  const testDialog = useRef<HTMLDialogElement>(null);
  const [fullscreenHost, setFullscreenHost] = useState<Element | null>(null);
  useEffect(() => {
    const sync = () => { testDialog.current?.close(); setFullscreenHost(document.fullscreenElement); };
    sync(); document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  return (
    <div
      className={`camera-tile ${hasThreat ? "has-threat" : ""} bg-slate-900 rounded-2xl border overflow-hidden transition ${
        hasThreat
          ? "border-red-500/80 ring-2 ring-red-500/25"
          : "border-slate-800 hover:border-slate-700"
      }`}
    >
      <div className="camera-tile-preview aspect-video bg-slate-950 relative group">
        {camera.is_active ? (
          <img
            src={`/api/cameras/${camera.id}/stream`}
            alt={camera.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-2">
            <Pause className="w-8 h-8 opacity-60" />
            <span className="text-xs font-medium">Поток приостановлен оператором</span>
          </div>
        )}

        <div className="absolute top-3 left-3 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold backdrop-blur-md ${
              !camera.is_active
                ? "bg-slate-800/90 text-slate-300"
                : !camera.online
                ? "bg-slate-800/90 text-amber-300"
                : hasThreat
                ? "bg-red-600/95 text-white animate-pulse"
                : "bg-slate-950/85 text-emerald-400 border border-emerald-500/30"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                !camera.is_active
                  ? "bg-slate-400"
                  : !camera.online
                  ? "bg-amber-400"
                  : hasThreat
                  ? "bg-white"
                  : "bg-emerald-400"
              }`}
            />
            {!camera.is_active
              ? "ПАУЗА"
              : !camera.online
              ? "НЕТ СВЯЗИ"
              : hasThreat
              ? "ТРЕВОГА В КАДРЕ"
              : `LIVE · ${camera.fps.toFixed(0)} FPS`}
          </span>
        </div>

        <button
          onClick={() => onExpand(camera)}
           title="Развернуть поток на весь экран"
           aria-label={`Развернуть камеру ${camera.name}`}
          className="absolute top-3 right-3 p-2 rounded-lg bg-slate-950/75 text-slate-200 opacity-0 group-hover:opacity-100 hover:bg-slate-900 transition"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      <div className="camera-tile-body p-4 space-y-3">
        {camera.last_error && <p className="text-xs text-red-300">{camera.last_error}</p>}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-white truncate">{camera.name}</h3>
              <p className="text-xs text-slate-400 truncate mt-0.5" title={camera.location}>
               {camera.location || "Расположение не указано"}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
          {onSettings && <button type="button" title="Настройки камеры" aria-label={`Настройки камеры ${camera.name}`} className="p-2 rounded-lg text-slate-400" onClick={() => onSettings(camera)}><Settings2 size={17} aria-hidden="true" /></button>}
          {canManage && <>
            <button
              onClick={() => onReconnect(camera.id)}
              title="Переподключить камеру"
              aria-label={`Переподключить камеру ${camera.name}`}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            ><RefreshCw className="w-4 h-4" /></button>
            <button
              onClick={() => onToggle(camera.id)}
              title={camera.is_active ? "Приостановить поток" : "Возобновить поток"}
              aria-label={`${camera.is_active ? "Приостановить" : "Возобновить"} поток камеры ${camera.name}`}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              {camera.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              onClick={() => onDelete(camera.id)}
              title="Удалить камеру"
              aria-label={`Удалить камеру ${camera.name}`}
              className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>}
          </div>
        </div>

        <div className="camera-tile-metadata"><span>{camera.is_simulated ? "Тестовый источник" : "Камера объекта"}</span><span>{camera.is_active && camera.online ? `${camera.latency_ms.toFixed(0)} мс` : camera.is_active ? "Нет связи" : "На паузе"}</span></div>
        {canManage && camera.is_simulated && camera.is_active && (
          <div className="pt-2.5 border-t border-slate-800/80">
            <button type="button" className="camera-test-trigger w-full" onClick={event => {
              const shell = event.currentTarget.closest(".app-shell");
              if (shell && testDialog.current) {
                const theme = getComputedStyle(shell);
                ["--workspace-panel", "--workspace-text", "--workspace-muted", "--workspace-line", "--accent", "--panel-radius"].forEach(key => testDialog.current!.style.setProperty(key, theme.getPropertyValue(key)));
              }
              testDialog.current?.showModal();
            }}>
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>Тест детекции</span>
            </button>
            {createPortal(<dialog ref={testDialog} className="camera-test-dialog" aria-label={`Тест детекции — ${camera.name}`} onClick={event => {
              if (event.target === event.currentTarget) {
                const bounds = event.currentTarget.getBoundingClientRect();
                if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
              }
            }}>
            <div className="camera-test-dialog-heading"><div><h3>Тест детекции</h3><p>{camera.name}</p></div><button type="button" aria-label="Закрыть выбор сценария" onClick={() => testDialog.current?.close()}><X className="w-5 h-5" /></button></div>
            <p className="text-sm text-slate-400 mb-3">Выберите сценарий для запуска на этой камере.</p>
            <div onClick={event => { if ((event.target as HTMLElement).closest("button")) testDialog.current?.close(); }}>
            <div className="camera-test-options">
              <button
                onClick={() => onSimulate(camera.id, "suspicious_bag")}
                className="px-2 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/25 text-[11px] font-medium transition"
              >
                Бесхозная сумка
              </button>
              <button
                onClick={() => onSimulate(camera.id, "dog")}
                className="px-2 py-1.5 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-300 border border-orange-500/25 text-[11px] font-medium transition"
              >
                Собака
              </button>
              <button
                onClick={() => onSimulate(camera.id, "weapon")}
                className="px-2 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/25 text-[11px] font-medium transition"
              >
                Оружие
              </button>
              <button
                onClick={() => onSimulate(camera.id, "person_with_bag")}
                title="Проверка отсутствия ложной тревоги, когда владелец идёт рядом с сумкой"
                className="px-2 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/25 text-[11px] font-medium transition"
              >
                Ученик с сумкой
              </button>
            </div>
            </div>
            </dialog>, fullscreenHost ?? document.body)}
          </div>
        )}
      </div>
    </div>
  );
};
