import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clock3,
  Crosshair,
  FlaskConical,
  Loader2,
  Plus,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { api, Camera, CameraPolicy, CameraZone, DetectorProfile, ZoneKind } from "../api/client";

interface CameraPolicyModalProps {
  camera: Camera;
  profiles: DetectorProfile[];
  onClose: () => void;
  onSaved: () => void;
}

type Tab = "zones" | "limits" | "ab";

const ZONE_COLORS = ["#10b981", "#f59e0b", "#ef4444", "#0ea5e9", "#a855f7"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const emptyZone = (index: number): CameraZone => ({
  name: `Зона ${index + 1}`,
  kind: "include",
  color: ZONE_COLORS[index % ZONE_COLORS.length],
  points: [],
});

export const CameraPolicyModal: React.FC<CameraPolicyModalProps> = ({
  camera,
  profiles,
  onClose,
  onSaved,
}) => {
  const [tab, setTab] = useState<Tab>("zones");
  const [policy, setPolicy] = useState<CameraPolicy | null>(null);
  const [zones, setZones] = useState<CameraZone[]>([]);
  const [activeZone, setActiveZone] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshotOk, setSnapshotOk] = useState(true);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getCameraPolicy(camera.id);
      setPolicy(data);
      setZones(data.zones?.length ? data.zones : []);
      setActiveZone(0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить политику камеры");
    } finally {
      setLoading(false);
    }
  }, [camera.id]);

  useEffect(() => {
    load();
  }, [load]);

  const patchPolicy = (patch: Partial<CameraPolicy>) => {
    setPolicy((current) => (current ? { ...current, ...patch } : current));
  };

  const addZone = () => {
    setZones((current) => {
      const next = [...current, emptyZone(current.length)];
      setActiveZone(next.length - 1);
      return next;
    });
  };

  const updateZone = (index: number, patch: Partial<CameraZone>) => {
    setZones((current) => current.map((zone, idx) => (idx === index ? { ...zone, ...patch } : zone)));
  };

  const removeZone = (index: number) => {
    setZones((current) => current.filter((_, idx) => idx !== index));
    setActiveZone(0);
  };

  const handleStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (zones.length === 0) {
      const zone = emptyZone(0);
      setZones([zone]);
      setActiveZone(0);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));
    setZones((current) =>
      current.map((zone, idx) =>
        idx === activeZone ? { ...zone, points: [...zone.points, [Number(x.toFixed(4)), Number(y.toFixed(4))]] } : zone
      )
    );
  };

  const undoPoint = () => {
    setZones((current) =>
      current.map((zone, idx) =>
        idx === activeZone ? { ...zone, points: zone.points.slice(0, -1) } : zone
      )
    );
  };

  const save = async () => {
    if (!policy) return;
    const cleanedZones = zones
      .map((zone) => ({ ...zone, points: zone.points.map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]) }))
      .filter((zone) => zone.points.length >= 3);
    setSaving(true);
    try {
      await api.saveCameraZones(camera.id, cleanedZones);
      await api.updateCameraPolicy(camera.id, {
        confidence_threshold: policy.confidence_threshold,
        schedule: policy.schedule,
        ab_profile: policy.ab_profile,
        ab_share_pct: policy.ab_share_pct,
        turnstile: policy.turnstile,
      });
      setError(null);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить настройки камеры");
    } finally {
      setSaving(false);
    }
  };

  const current = zones[activeZone];
  const polygonPoints = useMemo(
    () => (current?.points || []).map(([x, y]) => `${x * 100},${y * 100}`).join(" "),
    [current]
  );

  return (
    <div className="fixed inset-0 z-[65] bg-black/75 backdrop-blur-sm flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl my-4">
        <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-ink flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-brand-400" />
              Аналитика камеры: {camera.name}
            </h3>
            <p className="text-[11px] text-slate-400">
              {camera.location} · профиль {camera.detector_profile}
              {camera.zones_count ? ` · зон: ${camera.zones_count}` : " · зоны не заданы"}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-1 px-4 sm:px-5 pt-3">
          {[
            { id: "zones" as Tab, label: "Зоны ROI", icon: Crosshair },
            { id: "limits" as Tab, label: "Порог и расписание", icon: ShieldAlert },
            { id: "ab" as Tab, label: "A/B моделей", icon: FlaskConical },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium transition ${
                tab === item.id
                  ? "bg-brand-500/15 text-brand-200 border border-brand-500/40"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent"
              }`}
            >
              <item.icon className="w-3.5 h-3.5" /> {item.label}
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="py-16 flex items-center justify-center gap-2 text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Загрузка политики камеры…
            </div>
          ) : !policy ? (
            <p className="text-sm text-red-300">{error ?? "Нет данных"}</p>
          ) : tab === "zones" ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={activeZone}
                  onChange={(e) => setActiveZone(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200"
                >
                  {zones.length === 0 && <option value={0}>Новая зона</option>}
                  {zones.map((zone, index) => (
                    <option key={`${zone.name}-${index}`} value={index}>
                      {zone.name} · {zone.kind === "include" ? "анализ" : "исключение"}
                    </option>
                  ))}
                </select>
                <button
                  onClick={addZone}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200"
                >
                  <Plus className="w-3.5 h-3.5" /> Новая зона
                </button>
                <button
                  onClick={undoPoint}
                  disabled={!current?.points.length}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200 disabled:opacity-40"
                >
                  Отменить точку
                </button>
                {zones.length > 0 && (
                  <button
                    onClick={() => removeZone(activeZone)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] text-red-300 hover:bg-red-500/10 border border-red-500/30"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Удалить зону
                  </button>
                )}
                <span className="text-[10px] text-slate-500 ml-auto">Клик по кадру добавляет точку полигона</span>
              </div>

              <div
                ref={stageRef}
                onClick={handleStageClick}
                className="relative w-full aspect-video rounded-xl overflow-hidden border border-slate-700 bg-slate-950 cursor-crosshair select-none"
              >
                {snapshotOk ? (
                  <img
                    src={api.cameraSnapshotUrl(camera.id)}
                    alt="Кадр камеры"
                    className="absolute inset-0 w-full h-full object-cover opacity-80"
                    onError={() => setSnapshotOk(false)}
                    draggable={false}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500">
                    Кадр ещё не готов — рисуйте зону поверх сетки
                  </div>
                )}

                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                  {zones.map((zone, index) => (
                    <g key={`${zone.name}-${index}`} opacity={index === activeZone ? 1 : 0.55}>
                      {zone.points.length >= 3 && (
                        <polygon
                          points={zone.points.map(([x, y]) => `${x * 100},${y * 100}`).join(" ")}
                          fill={`${zone.color}33`}
                          stroke={zone.color}
                          strokeWidth={0.5}
                        />
                      )}
                      {zone.points.length < 3 && zone.points.length > 0 && (
                        <polyline
                          points={zone.points.map(([x, y]) => `${x * 100},${y * 100}`).join(" ")}
                          fill="none"
                          stroke={zone.color}
                          strokeWidth={0.5}
                          strokeDasharray="1.5 1"
                        />
                      )}
                      {zone.points.map(([x, y], pointIndex) => (
                        <circle key={pointIndex} cx={x * 100} cy={y * 100} r={0.9} fill={zone.color} />
                      ))}
                      {zone.points[0] && (
                        <text x={zone.points[0][0] * 100 + 1} y={zone.points[0][1] * 100 + 2.5} fontSize={3} fill={zone.color}>
                          {zone.name}
                        </text>
                      )}
                    </g>
                  ))}
                  {polygonPoints && <title>Зона</title>}
                </svg>
              </div>

              {current && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="space-y-1">
                    <span className="block text-[10px] uppercase text-slate-500">Название</span>
                    <input
                      value={current.name}
                      onChange={(e) => updateZone(activeZone, { name: e.target.value })}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200 w-44"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[10px] uppercase text-slate-500">Тип</span>
                    <select
                      value={current.kind}
                      onChange={(e) => updateZone(activeZone, { kind: e.target.value as ZoneKind })}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200"
                    >
                      <option value="include">Анализировать (include)</option>
                      <option value="exclude">Игнорировать (exclude)</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[10px] uppercase text-slate-500">Цвет</span>
                    <div className="flex items-center gap-1">
                      {ZONE_COLORS.map((color) => (
                        <button
                          key={color}
                          onClick={() => updateZone(activeZone, { color })}
                          className={`w-6 h-6 rounded-lg border-2 ${current.color === color ? "border-white" : "border-transparent"}`}
                          style={{ backgroundColor: color }}
                          aria-label={`Цвет ${color}`}
                        />
                      ))}
                    </div>
                  </label>
                  <span className="text-[10px] text-slate-500">
                    Точек: {current.points.length} {current.points.length < 3 ? "(нужно ≥ 3)" : "✓"}
                  </span>
                </div>
              )}
              <p className="text-[10.5px] text-slate-500 leading-relaxed">
                Include-зоны ограничивают анализ: тревога фиксируется только если центр объекта попал в зону.
                Exclude-зоны (парковка, улица за забором) подавляют ложные срабатывания. Координаты хранятся
                в долях кадра и не зависят от разрешения потока.
              </p>
            </>
          ) : tab === "limits" ? (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-3">
                <p className="text-[11px] font-semibold text-ink flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-brand-400" /> Порог уверенности YOLO
                </p>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Порог камеры</span>
                  <span className="font-mono text-slate-200">
                    {policy.confidence_threshold !== null
                      ? `${Math.round(policy.confidence_threshold * 100)}%`
                      : "как в системе"}
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={95}
                  step={1}
                  value={Math.round((policy.confidence_threshold ?? 0.42) * 100)}
                  onChange={(e) => patchPolicy({ confidence_threshold: Number(e.target.value) / 100 })}
                  className="w-full accent-brand-500"
                />
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-slate-500 max-w-[70%]">
                    Выше — меньше ложных тревог, но можно пропустить объект. Ниже — чувствительнее.
                  </p>
                  <button
                    onClick={() => patchPolicy({ confidence_threshold: null })}
                    className="text-[10px] px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                  >
                    Сбросить
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-3">
                <p className="text-[11px] font-semibold text-ink flex items-center gap-1.5">
                  <Clock3 className="w-3.5 h-3.5 text-sky-400" /> Расписание аналитики
                </p>
                <label className="inline-flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(policy.schedule?.enabled)}
                    onChange={(e) =>
                      patchPolicy({
                        schedule: {
                          days: policy.schedule?.days?.length ? policy.schedule.days : [0, 1, 2, 3, 4],
                          start: policy.schedule?.start ?? "07:30",
                          end: policy.schedule?.end ?? "19:30",
                          ...policy.schedule,
                          enabled: e.target.checked,
                        },
                      })
                    }
                    className="rounded accent-brand-500"
                  />
                  Записывать инциденты только в указанное время
                </label>
                <div className="flex flex-wrap gap-1">
                  {WEEKDAYS.map((label, index) => {
                    const days = policy.schedule?.days ?? [];
                    const active = days.includes(index);
                    return (
                      <button
                        key={label}
                        onClick={() =>
                          patchPolicy({
                            schedule: {
                              ...policy.schedule,
                              enabled: policy.schedule?.enabled ?? true,
                              days: active ? days.filter((d) => d !== index) : [...days, index],
                            },
                          })
                        }
                        className={`w-8 h-8 rounded-lg text-[10px] font-medium border transition ${
                          active
                            ? "bg-brand-500/20 border-brand-500/50 text-brand-200"
                            : "bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={policy.schedule?.start ?? "07:30"}
                    onChange={(e) => patchPolicy({ schedule: { ...policy.schedule, start: e.target.value, enabled: true } })}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200"
                  />
                  <span className="text-slate-500 text-[11px]">—</span>
                  <input
                    type="time"
                    value={policy.schedule?.end ?? "19:30"}
                    onChange={(e) => patchPolicy({ schedule: { ...policy.schedule, end: e.target.value, enabled: true } })}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-200"
                  />
                  <span className="text-[10px] text-slate-500">вне окна поток идёт, но инциденты не пишутся</span>
                </div>
              </div>

              <label className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-1.5 block md:col-span-2">
                <span className="text-[11px] font-semibold text-ink">Турникет / точка СКУД</span>
                <input
                  value={policy.turnstile ?? ""}
                  onChange={(e) => patchPolicy({ turnstile: e.target.value })}
                  placeholder="Например, Турникет А (главный вход)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-[11px] text-slate-200"
                />
                <span className="block text-[10px] text-slate-500">
                  Связывает камеру с проходами СКУД, чтобы сверять видео с журналом турникета.
                </span>
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-3">
                <p className="text-[11px] font-semibold text-ink flex items-center gap-1.5">
                  <FlaskConical className="w-3.5 h-3.5 text-sky-400" /> A/B-тест профилей детекции
                </p>
                <p className="text-[10.5px] text-slate-500">
                  Часть кадров камеры обрабатывается вторым профилем YOLO. Результаты сравниваются в
                  «Аналитике»: уверенность, ложные срабатывания и скорость реакции.
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="block text-[10px] uppercase text-slate-500">Профиль A (основной)</span>
                    <select
                      value={camera.detector_profile}
                      onChange={(e) => {
                        api.setCameraDetector(camera.id, e.target.value).then(() => load()).catch(() => {});
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200"
                    >
                      {profiles.map((profile) => (
                        <option key={profile.key} value={profile.key}>
                          {profile.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[10px] uppercase text-slate-500">Профиль B (эксперимент)</span>
                    <select
                      value={policy.ab_profile ?? ""}
                      onChange={(e) => patchPolicy({ ab_profile: e.target.value || null })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-200"
                    >
                      <option value="">Не использовать A/B</option>
                      {profiles
                        .filter((profile) => profile.key !== camera.detector_profile)
                        .map((profile) => (
                          <option key={profile.key} value={profile.key}>
                            {profile.label}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Доля кадров для профиля B</span>
                    <span className="font-mono text-slate-200">{policy.ab_share_pct}%</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={policy.ab_share_pct}
                    disabled={!policy.ab_profile}
                    onChange={(e) => patchPolicy({ ab_share_pct: Number(e.target.value) })}
                    className="w-full accent-sky-500 disabled:opacity-40"
                  />
                </label>
                <p className="text-[10px] text-slate-500">
                  Рекомендуется 10–30%: достаточная выборка для сравнения без потери качества основной модели.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-t border-slate-800">
          <p className="text-[10px] text-slate-500">
            Изменения применяются на работающем потоке — без перезапуска камеры.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200"
            >
              Отмена
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-[11px] font-medium text-white disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
