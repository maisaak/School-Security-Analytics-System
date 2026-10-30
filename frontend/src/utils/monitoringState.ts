export interface MonitoringState { columns: number; pinned: number[]; autofocus: boolean }

export function readMonitoringState(raw: string | null): MonitoringState {
  const fallback = { columns: 2, pinned: [], autofocus: false };
  try {
    const saved: unknown = JSON.parse(raw || "null");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return fallback;
    const value = saved as Record<string, unknown>;
    return {
      columns: [1, 2, 4, 8].includes(value.columns as number) ? value.columns as number : 2,
      pinned: Array.isArray(value.pinned) ? [...new Set(value.pinned.filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0))].slice(0, 256) : [],
      autofocus: value.autofocus === true,
    };
  } catch { return fallback; }
}
