import React, { useState } from "react";
import { Plus, X } from "lucide-react";

interface AddCameraModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { name: string; location: string; rtsp_url: string }) => Promise<void>;
}

const PRESETS = [
  {
    label: "Симулятор: Турникеты входа",
    name: "Камера №4 — Запасной вход",
    location: "Блок Б, 1 этаж",
    rtsp_url: "sim://entrance",
  },
  {
    label: "Симулятор: Коридор 2 этажа",
    name: "Камера №5 — Коридор 2 этажа",
    location: "Учебный корпус",
    rtsp_url: "sim://hallway",
  },
  {
    label: "Симулятор: Спортплощадка",
    name: "Камера №6 — Периметр двора",
    location: "Восточные ворота",
    rtsp_url: "sim://courtyard",
  },
];

export const AddCameraModal: React.FC<AddCameraModalProps> = ({ open, onClose, onSubmit }) => {
  const [name, setName] = useState("Камера №4 — Запасной выход");
  const [location, setLocation] = useState("Крыло начальной школы");
  const [rtspUrl, setRtspUrl] = useState("sim://hallway");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !rtspUrl.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), location: location.trim(), rtsp_url: rtspUrl.trim() });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-ink">Подключение новой камеры</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Поддерживаются RTSP-потоки IP-камер (<code className="text-brand-300">rtsp://...</code>), HTTP/MP4 и стенды <code className="text-brand-300">sim://</code>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-ink hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2">
          <span className="text-xs text-slate-400">Быстрые шаблоны для демонстрации:</span>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setName(p.name);
                  setLocation(p.location);
                  setRtspUrl(p.rtsp_url);
                }}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Название камеры</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Камера №4 — Гардероб"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Расположение / Зона</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="1 этаж, северное крыло"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">RTSP URL или адрес потока</label>
            <input
              required
              value={rtspUrl}
              onChange={(e) => setRtspUrl(e.target.value)}
              placeholder="rtsp://admin:password@192.168.1.50:554/h264Preview_01_main"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-700 text-sm text-slate-300 hover:bg-slate-800"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-medium text-white flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {submitting ? "Подключение..." : "Запустить мониторинг"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
