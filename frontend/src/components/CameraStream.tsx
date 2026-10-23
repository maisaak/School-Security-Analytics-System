import React, { useEffect, useRef, useState } from "react";
import type HlsType from "hls.js";
import { Loader2, Radio, Video, VideoOff } from "lucide-react";
import { api, Camera, StreamMode } from "../api/client";

interface CameraStreamProps {
  camera: Camera;
  /** Дополнительные классы для <video>/<img> (object-cover и т.п.) */
  className?: string;
  /** Показывать переключатель HLS / MJPEG в углу кадра */
  showSwitch?: boolean;
  onModeChange?: (mode: StreamMode) => void;
}

const MODE_STORAGE_PREFIX = "school_security_stream_mode:";

function readPreferredMode(camera: Camera): StreamMode {
  try {
    const stored = window.localStorage.getItem(`${MODE_STORAGE_PREFIX}${camera.id}`);
    if (stored === "hls" || stored === "mjpeg") return stored;
  } catch {
    // приватный режим — работаем без запоминания
  }
  return camera.stream_mode === "hls" ? "hls" : "mjpeg";
}

/**
 * Живой кадр камеры.
 *
 * Для RTSP-камер сервер публикует аннотированные кадры как HLS (H.264 + mpeg-ts),
 * поэтому видео играется обычным <video> через hls.js — без MJPEG-перерисовки <img>.
 * Если HLS недоступен (нет поддержки MSE, плейлист ещё не готов, ошибка сети),
 * компонент автоматически откатывается на MJPEG и сообщает об этом.
 */
export const CameraStream: React.FC<CameraStreamProps> = ({
  camera,
  className,
  showSwitch = true,
  onModeChange,
}) => {
  const [mode, setMode] = useState<StreamMode>(() => readPreferredMode(camera));
  const [status, setStatus] = useState<"connecting" | "playing" | "fallback">("connecting");
  // Пользователь явно выбрал режим — автоапгрейд до HLS больше не вмешивается
  const [userChosen, setUserChosen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(`${MODE_STORAGE_PREFIX}${camera.id}`) !== null;
    } catch {
      return false;
    }
  });
  const videoRef = useRef<HTMLVideoElement>(null);

  const changeMode = (next: StreamMode) => {
    setMode(next);
    setUserChosen(true);
    setStatus(next === "hls" ? "connecting" : "playing");
    try {
      window.localStorage.setItem(`${MODE_STORAGE_PREFIX}${camera.id}`, next);
    } catch {
      // ignore
    }
    onModeChange?.(next);
  };

  // HLS готовится ~1–2 секунды после старта камеры: как только бэкенд сообщает,
  // что плейлист нарезан, поднимаемся с MJPEG на HLS (если пользователь не выбрал вручную)
  useEffect(() => {
    if (userChosen || camera.stream_mode !== "hls" || mode === "hls" || !camera.is_active) return;
    const mseSupported =
      typeof window !== "undefined" &&
      ("MediaSource" in window || "ManagedMediaSource" in window);
    if (!mseSupported) return;
    setMode("hls");
    setStatus("connecting");
  }, [camera.stream_mode, camera.is_active, mode, userChosen]);

  useEffect(() => {
    if (mode !== "hls" || !camera.is_active) return;
    const video = videoRef.current;
    if (!video) return;

    let hls: HlsType | null = null;
    let disposed = false;

    const fallbackToMjpeg = () => {
      if (disposed) return;
      setStatus("fallback");
      changeMode("mjpeg");
      setTimeout(() => setStatus("playing"), 2500);
    };

    const canPlayNative = video.canPlayType("application/vnd.apple.mpegurl") !== "";

    // hls.js (~500 КБ) грузим отдельным чанком: на экране входа он не нужен
    import("hls.js")
      .then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) {
          if (canPlayNative) {
            video.src = api.hlsUrl(camera.id);
            video
              .play()
              .then(() => setStatus("playing"))
              .catch(fallbackToMjpeg);
          } else {
            fallbackToMjpeg();
          }
          return;
        }

        hls = new Hls({
          lowLatencyMode: false,
          liveSyncDurationCount: 2,
          maxBufferLength: 6,
          manifestLoadingMaxRetry: 2,
          levelLoadingMaxRetry: 2,
          fragLoadingMaxRetry: 2,
          xhrSetup: (xhr, url) => api.authorizeXhr(xhr, url),
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (disposed) return;
          setStatus("playing");
          video.play().catch(() => undefined);
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          fallbackToMjpeg();
        });
        hls.loadSource(api.hlsUrl(camera.id));
        hls.attachMedia(video);
      })
      .catch(fallbackToMjpeg);

    return () => {
      disposed = true;
      if (hls) {
        hls.destroy();
        hls = null;
      }
      const el = videoRef.current;
      if (el) {
        el.removeAttribute("src");
        el.load();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, camera.id, camera.is_active]);

  if (!camera.is_active) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-2">
        <VideoOff className="w-8 h-8 opacity-60" />
        <span className="text-xs font-medium">Поток приостановлен оператором</span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black">
      {mode === "hls" ? (
        <video
          ref={videoRef}
          className={className ?? "w-full h-full object-cover"}
          muted
          autoPlay
          playsInline
          preload="auto"
        />
      ) : (
        <img
          src={api.streamUrl(camera.id)}
          alt={camera.name}
          className={className ?? "w-full h-full object-cover"}
        />
      )}

      {status === "connecting" && mode === "hls" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/70 text-slate-300">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
          <span className="text-[11px]">Подключение HLS-потока…</span>
        </div>
      )}

      {status === "fallback" && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-amber-500/90 px-2 py-1 text-[10px] font-medium text-black">
          HLS недоступен — включён MJPEG
        </div>
      )}

      {showSwitch && (
        <button
          type="button"
          onClick={() => changeMode(mode === "hls" ? "mjpeg" : "hls")}
          title={
            mode === "hls"
              ? "Смотреть через MJPEG (по кадрам)"
              : "Смотреть через HLS (обычный видеоплеер)"
          }
          className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-slate-950/80 px-2 py-1 text-[10px] font-semibold text-slate-200 backdrop-blur transition hover:bg-slate-900"
        >
          {mode === "hls" ? (
            <>
              <Radio className="w-3 h-3 text-emerald-400" /> HLS
            </>
          ) : (
            <>
              <Video className="w-3 h-3 text-sky-400" /> MJPEG
            </>
          )}
        </button>
      )}
    </div>
  );
};
