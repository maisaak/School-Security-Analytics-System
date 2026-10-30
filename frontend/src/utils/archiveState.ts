export const emptyArchiveFilters = { camera: "", type: "", status: "", from: "", to: "", confidence: "" };
export type ArchiveFormFilters = typeof emptyArchiveFilters;

export function readArchivePresets(raw: string | null): Record<string, ArchiveFormFilters> {
  try {
    const data: unknown = JSON.parse(raw || "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).slice(0, 30).flatMap(([name, filters]) => {
      if (!name.trim() || name.length > 80 || !filters || typeof filters !== "object" || Array.isArray(filters)) return [];
      const record = filters as Record<string, unknown>;
      if (!Object.keys(emptyArchiveFilters).every(key => typeof record[key] === "string" && (record[key] as string).length <= 120)) return [];
      return [[name, Object.fromEntries(Object.keys(emptyArchiveFilters).map(key => [key, record[key]])) as ArchiveFormFilters]];
    }));
  } catch { return {}; }
}

export function archiveRequest(filters: ArchiveFormFilters, page: number) {
  if (!Number.isSafeInteger(page) || page < 0) throw new Error("Некорректная страница архива");
  if (filters.type && !["weapon", "suspicious_bag", "dog"].includes(filters.type)) throw new Error("Выберите корректный тип события");
  if (filters.status && !["new", "in_review", "confirmed", "false_alarm", "closed"].includes(filters.status)) throw new Error("Выберите корректный статус события");
  const date = (value: string) => {
    if (!value) return undefined;
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) throw new Error("Укажите корректные дату и время");
    return new Date(timestamp).toISOString();
  };
  const date_from = date(filters.from), date_to = date(filters.to);
  if (date_from && date_to && date_from >= date_to) throw new Error("Конец периода должен быть позже начала");
  const confidence = filters.confidence ? Number(filters.confidence) : undefined;
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 100)) throw new Error("Уверенность должна быть от 0 до 100%");
  const camera = filters.camera ? Number(filters.camera) : undefined;
  if (camera !== undefined && (!Number.isSafeInteger(camera) || camera < 1)) throw new Error("Выберите корректную камеру");
  return { camera_id: camera, violation_type: filters.type || undefined, review_status: filters.status || undefined,
    date_from, date_to, min_confidence: confidence === undefined ? undefined : confidence / 100, limit: 100, offset: page * 100 };
}

export function localIncidentDay(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Дата неизвестна";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}
