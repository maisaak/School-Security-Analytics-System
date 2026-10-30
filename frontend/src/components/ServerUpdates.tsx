import React, { useEffect, useState } from "react";
import { api } from "../api/client";

export function ServerUpdates() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.updateStatus>> | null>(null);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    try { await work(); setStatus(await api.updateStatus()); }
    catch (error) { setResult(error instanceof Error ? error.message : "Ошибка обновления"); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    const refresh = () => api.updateStatus().then(value => { if (active) setStatus(value); }).catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
    <h3 className="settings-panel-title">Обновление сервера</h3>
    <p className="text-xs text-slate-400">GitHub · main · версия {status?.current?.slice(0, 8) ?? "не определена"}</p>
    {!status?.enabled && <p className="text-xs text-amber-300">Установка отключена. Для Ubuntu/Debian настройте отдельную службу по docs/SERVER_UPDATES.md. Проверка GitHub доступна без неё.</p>}
    <div className="flex flex-wrap gap-3">
      <button disabled={busy} className="border border-slate-700 rounded-lg px-4 py-2" onClick={() => action(async () => { const value = await api.checkUpdate(); setResult(!value.current ? "Локальная версия Git не определена" : value.update_available ? `Доступна версия ${value.latest.slice(0, 8)}` : "Установлена актуальная версия"); })}>Проверить GitHub</button>
      <button disabled={busy || !status?.enabled || status.pending} className="accent-button rounded-lg px-4 py-2" onClick={() => { if (window.confirm("Обновление временно остановит камеры и API. Продолжить?")) action(async () => { await api.installUpdate(); setResult("Запрос принят. Установка начнётся в течение минуты. После завершения обновите страницу."); }); }}>Обновить сервер</button>
    </div>
    <label className="custom-check-row"><input type="checkbox" className="custom-checkbox" disabled={busy || !status?.enabled} checked={status?.auto_update ?? false} onChange={event => { const enabled = event.target.checked; if (!enabled || window.confirm("Автоматически устанавливать изменения из main с перезапуском сервера?")) action(async () => { await api.autoUpdate(enabled); }); }} /><span>Автоматически устанавливать обновления из GitHub</span></label>
    {status && <p className="text-xs text-slate-400">{status.pending ? "Ожидает выполнения" : status.job.status} · {status.job.message ?? ""}</p>}
    {result && <p role="status" className="text-sm text-slate-300">{result}</p>}
  </section>;
}
