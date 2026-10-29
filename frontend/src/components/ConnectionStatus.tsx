import React, { useEffect, useState } from "react";

export function ConnectionStatus() {
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");
  useEffect(() => {
    let disposed = false;
    let pending = false;
    let controller: AbortController | null = null;
    async function check() {
      if (pending) return;
      pending = true;
      const current = new AbortController();
      controller = current;
      const timeout = window.setTimeout(() => current.abort(), 8000);
      try {
        const response = await fetch("/api/system/status", { credentials: "same-origin", signal: current.signal });
        const result = response.ok ? await response.json() : null;
        if (!disposed) setStatus(result?.api === "ok" && result?.database === "ok" ? "online" : "offline");
      } catch { if (!disposed) setStatus("offline"); }
      finally { window.clearTimeout(timeout); pending = false; }
    }
    void check();
    const timer = window.setInterval(check, 15000);
    return () => { disposed = true; controller?.abort(); window.clearInterval(timer); };
  }, []);
  return <span role="status" className={`connection-status connection-${status}`}>
    <span aria-hidden="true" />{status === "checking" ? "Проверка сервера…" : status === "online" ? "Сервер и база доступны" : "Нет связи с сервером или базой"}
  </span>;
}
