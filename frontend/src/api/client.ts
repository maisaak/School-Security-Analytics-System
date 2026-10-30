export type ViolationType = "weapon" | "suspicious_bag" | "dog";

export interface Camera {
  id: number;
  name: string;
  location: string;
  rtsp_url: string;
  target_fps: number;
  jpeg_quality: number;
  detect_every: number;
  is_active: boolean;
  created_at: string;
  online: boolean;
  fps: number;
  latency_ms: number;
  person_count: number;
  active_threats: string[];
  is_simulated: boolean;
  last_error: string | null;
}

export interface Violation {
  id: number;
  camera_id: number;
  camera_name: string;
  camera_location: string;
  violation_type: ViolationType;
  confidence: number;
  bbox: number[];
  image_path: string;
  video_url: string;
  is_acknowledged: boolean;
  review_status: "new" | "in_review" | "confirmed" | "false_alarm" | "closed";
  review_comment: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  detected_at: string;
}

export interface DashboardStats {
  total_cameras: number;
  active_cameras: number;
  total_violations: number;
  unacknowledged_violations: number;
  confirmed_violations: number;
  pending_violations: number;
  false_alarm_violations: number;
  average_confidence: number;
  by_type: Record<string, number>;
  timeline: Array<{ label: string; count: number }>;
  by_camera: Array<{ id: number; name: string; location: string; total: number; unacknowledged: number; online: boolean; latency_ms: number }>;
  model: {
    active_weights: string;
    reloaded_at: string;
    avg_latency_ms: number;
  };
}

export interface DatasetInfo {
  train_images: number;
  val_images: number;
  total_images: number;
  user_uploaded_images: number;
  class_annotations: Record<string, number>;
}

export interface RetrainJob {
  id: number;
  status: "queued" | "running" | "completed" | "failed" | "ready" | "active";
  epochs: number;
  current_epoch: number;
  progress_pct: number;
  dataset_yaml: string;
  metrics: Record<string, number>;
  details: string;
  created_at: string;
  completed_at: string | null;
}

export interface AnalyzeUploadResult {
  media_type: "image" | "video";
  result_url: string;
  violations: Array<{ type: ViolationType; confidence: number; bbox: number[] }>;
  safe_objects: Array<{ kind: string; label: string; confidence: number; bbox: number[] }>;
  latency_ms?: number;
  frames_processed?: number;
  saved_violation_ids: number[];
  warning?: string;
}

const API_BASE = "/api";

export interface User { id: number | null; username: string; display_name: string; role: string; role_name?: string; permissions?: string[] }
export interface Employee extends User { id: number; is_active: boolean }
export interface Role { key: string; name: string; description: string; permissions: string[]; is_system: boolean }
export interface Preferences { columns: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; show_stats: boolean; show_archive: boolean; show_alerts: boolean; compact: boolean; default_tab: "dashboard" | "monitoring" | "analytics" | "lab" | "training" | "settings"; theme: "dark" | "light" | "system"; accent: string; animations: boolean; rounding: "none" | "small" | "large"; liquid_glass: boolean; transparency: number }
export const defaultPreferences: Preferences = { columns: 3, show_stats: true, show_archive: true, show_alerts: true, compact: false, default_tab: "dashboard", theme: "dark", accent: "#6366f1", animations: true, rounding: "large", liquid_glass: true, transparency: 25 };
export interface ModelCatalog { active_base: string; custom_weights: string | null; models: Array<{ id: string; label: string; filename: string; installed: boolean }> }
export interface AuditEntry { id: number; employee_id: number | null; username: string; action: string; method: string; path: string; status_code: number; ip_address: string | null; created_at: string }
export interface Diagnostics { status: string; api: string; database: string; model: { base: string; active: string; path_exists: boolean }; disk: { free_bytes: number; total_bytes: number; free_percent: number }; training: { running_jobs: number; local_enabled: boolean }; cameras: Array<{ id: number; name: string; active: boolean; online: boolean; fps: number; latency_ms: number; last_error: string | null }> }
export interface ActiveSession { expires_at: string; current: boolean }
export interface DetectionRules {
  enabled_classes: Array<"weapon" | "suspicious_bag" | "dog">;
  zones: Array<{ id: string; name: string; mode: "include" | "exclude"; points: [number, number][] }>;
  schedule: { enabled: boolean; timezone: string; windows: Array<{ weekdays: number[]; start: string; end: string }> };
}
export interface FloorPlan { id: string; name: string; image_url: string; width: number; height: number; placements: Array<{ camera_id: number; x: number; y: number }> }
export interface CameraProbe { ok: boolean; latency_ms: number; width: number | null; height: number | null; preview_data_url: string | null; error_code: string | null; message: string }
export interface ArchiveFilters { violation_type?: string; camera_id?: number; review_status?: string; unacknowledged_only?: boolean; date_from?: string; date_to?: string; min_confidence?: number; limit?: number; offset?: number }

function archiveQuery(params?: ArchiveFilters): URLSearchParams {
  const query = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => { if (value !== undefined && value !== "" && value !== false) query.set(key, String(value)); });
  return query;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("X-Requested-With", "SchoolSecurity");
  let res: Response;
  const controller = new AbortController();
  const timeout = path === "/recording-settings" || path === "/roles"
    ? window.setTimeout(() => controller.abort(), 20000) : undefined;
  const abort = () => controller.abort();
  init?.signal?.addEventListener("abort", abort, { once: true });
  if (init?.signal?.aborted) controller.abort();
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: controller.signal, credentials: "same-origin" });
  } catch {
    if (controller.signal.aborted) throw new Error("Сервер не ответил за 20 секунд или запрос отменён. Повторите попытку. При сохранении сначала проверьте результат: операция могла выполниться.");
    throw new Error("Нет соединения с сервером. Проверьте сеть и запуск backend.");
  } finally {
    window.clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", abort);
  }
  if (!res.ok) {
    if (res.status === 401 && path !== "/auth/login") window.dispatchEvent(new Event("session-expired"));
    let detail = res.status >= 500
      ? "Сервер временно недоступен. Проверьте запуск backend или обратитесь к администратору."
      : `Запрос не выполнен (код ${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      // ignore parse error
    }
    throw new Error(detail);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

export const api = {
  getCameraRules: (id: number) => request<DetectionRules>(`/cameras/${id}/rules`),
  setCameraRules: (id: number, value: DetectionRules) => request<DetectionRules>(`/cameras/${id}/rules`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
  probeCamera: (value: { camera_id: number } | { rtsp_url: string }) => request<CameraProbe>("/cameras/probe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
  getFloorPlans: () => request<FloorPlan[]>("/floor-plans"),
  uploadFloorPlan: (name: string, file: File) => { const body = new FormData(); body.set("name", name); body.set("file", file); return request<FloorPlan>("/floor-plans", { method: "POST", body }); },
  setFloorPlanPlacements: (id: string, placements: FloorPlan["placements"]) => request<FloorPlan>(`/floor-plans/${encodeURIComponent(id)}/placements`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ placements }) }),
  deleteFloorPlan: (id: string) => request<void>(`/floor-plans/${encodeURIComponent(id)}`, { method: "DELETE" }),
  exportArchive: async (params: ArchiveFilters, format: "csv" | "zip", ids?: number[]) => {
    if (ids && ids.length === 0) throw new Error("Сначала выберите события для экспорта");
    const query = archiveQuery(params); query.delete("offset"); query.delete("limit");
    if (ids) query.set("ids", ids.join(","));
    const response = await fetch(`${API_BASE}/violations/export.${format}?${query}`, { credentials: "same-origin", headers: { "X-Requested-With": "SchoolSecurity" } });
    if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(typeof data?.detail === "string" ? data.detail : "Не удалось экспортировать архив"); }
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = `violations.${format}`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  updateStatus: () => request<{ enabled: boolean; current: string | null; auto_update: boolean; pending: boolean; job: { status: string; message?: string } }>("/system/updates"),
  checkUpdate: () => request<{ current: string | null; latest: string; update_available: boolean }>("/system/updates/check", { method: "POST" }),
  installUpdate: () => request<{ queued: boolean }>("/system/updates/install", { method: "POST" }),
  autoUpdate: (enabled: boolean) => request("/system/updates/auto", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }),
  session: () => request<{ authenticated: boolean; dev_mode: boolean; user: User }>("/auth/session"),
  loginEmployee: (username: string, password: string, totp_code?: string) => request("/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, totp_code }),
  }),
  getPreferences: () => request<Preferences>("/preferences"),
  setPreferences: (value: Preferences) => request<Preferences>("/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
  getEmployees: () => request<Employee[]>("/employees"),
  getRoles: () => request<Role[]>("/roles"),
  createRole: (value: { name: string; description: string; permissions: string[] }) => request<Role>("/roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
  deleteRole: (key: string) => request<{ deleted: string }>(`/roles/${encodeURIComponent(key)}`, { method: "DELETE" }),
  getAudit: (limit = 100) => request<AuditEntry[]>(`/audit?limit=${limit}`),
  getDiagnostics: () => request<Diagnostics>("/system/diagnostics"),
  createEmployee: (value: { username: string; display_name: string; password: string; role: string }) => request<Employee>("/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
  updateEmployee: (id: number, value: { is_active?: boolean; role?: string; password?: string }) => request<Employee>(`/employees/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
  modelCatalog: () => request<ModelCatalog>("/models/catalog"),
  selectModel: (model_id: string, allow_download: boolean) => request<ModelCatalog>("/models/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model_id, allow_download }) }),
  login: (key: string) => request("/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: key }),
  }),
  logout: () => request("/auth/logout", { method: "POST" }),
  getSessions: () => request<ActiveSession[]>("/auth/sessions"),
  revokeAllSessions: () => request<{ revoked: boolean }>("/auth/sessions/revoke-all", { method: "POST" }),
  changePassword: (current_password: string, new_password: string) => request<{ changed: boolean }>("/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current_password, new_password }) }),
  twoFactorStatus: () => request<{ enabled: boolean; available: boolean }>("/auth/2fa"),
  twoFactorSetup: (current_password: string) => request<{ secret: string; otpauth_url: string }>("/auth/2fa/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current_password }) }),
  twoFactorEnable: (code: string) => request<{ enabled: boolean }>("/auth/2fa/enable", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code }) }),
  twoFactorDisable: (current_password: string, code: string) => request<{ enabled: boolean }>("/auth/2fa/disable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current_password, code }) }),
  getThresholds: () => request<{ confidence: number; weapon_confidence: number; custom_confidence: number }>("/models/thresholds"),
  getRecordingSettings: () => request<{ before_seconds: number; after_seconds: number }>("/recording-settings"),
  setRecordingSettings: (value: { before_seconds: number; after_seconds: number }) => request<typeof value>("/recording-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
  setThresholds: (value: { confidence: number; weapon_confidence: number; custom_confidence: number }) => request<typeof value>("/models/thresholds", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
  getStats: () => request<DashboardStats>("/stats"),

  getCameras: () => request<Camera[]>("/cameras"),

  addCamera: (payload: { name: string; location: string; rtsp_url: string }) =>
    request<Camera>("/cameras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  toggleCamera: (id: number) =>
    request<Camera>(`/cameras/${id}/toggle`, { method: "POST" }),
  reconnectCamera: (id: number) => request<Camera>(`/cameras/${id}/reconnect`, { method: "POST" }),
  updateCameraSettings: (id: number, value: { name: string; location: string; rtsp_url?: string; target_fps: number; jpeg_quality: number; detect_every: number }) => request<Camera>(`/cameras/${id}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),

  deleteCamera: (id: number) =>
    request<void>(`/cameras/${id}`, { method: "DELETE" }),

  simulateEvent: (
    cameraId: number,
    scenario: "suspicious_bag" | "dog" | "weapon" | "person_with_bag"
  ) =>
    request<{ status: string }>(`/cameras/${cameraId}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario }),
    }),

  getViolations: (params?: ArchiveFilters) => {
    const q = archiveQuery(params);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return request<Violation[]>(`/violations${suffix}`);
  },
  exportViolations: async (params?: { violation_type?: string; camera_id?: number; review_status?: string; unacknowledged_only?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.violation_type) q.set("violation_type", params.violation_type);
    if (params?.camera_id) q.set("camera_id", String(params.camera_id));
    if (params?.review_status) q.set("review_status", params.review_status);
    if (params?.unacknowledged_only) q.set("unacknowledged_only", "true");
    const response = await fetch(`${API_BASE}/violations/export.csv${q.toString() ? `?${q}` : ""}`, { credentials: "same-origin", headers: { "X-Requested-With": "SchoolSecurity" } });
    if (!response.ok) throw new Error(response.status === 403 ? "Нет права на экспорт архива" : `Не удалось экспортировать архив (код ${response.status})`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "violations.csv"; link.click(); URL.revokeObjectURL(url);
  },

  acknowledgeViolation: (id: number) =>
    request<Violation>(`/violations/${id}/ack`, { method: "PATCH" }),
  reviewViolation: (id: number, status: Violation["review_status"], comment: string) =>
    request<Violation>(`/violations/${id}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, comment }) }),

  deleteViolation: (id: number) =>
    request<void>(`/violations/${id}`, { method: "DELETE" }),

  analyzeMedia: (file: File, saveViolation: boolean) => {
    const form = new FormData();
    form.append("file", file);
    form.append("save_violation", String(saveViolation));
    return request<AnalyzeUploadResult>("/analyze/upload", {
      method: "POST",
      body: form,
    });
  },

  getDatasetInfo: () => request<DatasetInfo>("/models/dataset"),

  uploadDatasetSample: (file: File, violationType: ViolationType, bbox: number[], split: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("violation_type", violationType);
    form.append("bbox", JSON.stringify(bbox));
    form.append("split", split);
    return request<{ status: string; filename: string; dataset: DatasetInfo }>(
      "/models/dataset/upload",
      { method: "POST", body: form }
    );
  },

  getRetrainJobs: () => request<RetrainJob[]>("/models/jobs"),
  activateModel: (id: number) => request(`/models/jobs/${id}/activate`, { method: "POST" }),

  retrainModel: (epochs: number, datasetYaml = "ml/datasets/school_security.yaml") =>
    request<RetrainJob>("/models/retrain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ epochs, dataset_yaml: datasetYaml }),
    }),
};
