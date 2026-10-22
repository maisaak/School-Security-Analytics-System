export type ViolationType = "weapon" | "suspicious_bag" | "dog";
export type Role = "admin" | "director" | "guard";

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  is_demo: boolean;
  permissions: string[];
  created_at: string;
  last_login_at: string | null;
  totp_enabled: boolean;
  camera_scope: number[];
}

export interface DemoAccount {
  username: string;
  role: Role;
  role_label: string;
  full_name: string;
  description: string;
  password_hint: string;
}

export interface AuthSession {
  user: User;
  expires_at: string;
  token_type: string;
  access_token: string | null;
}

export interface BagTrack {
  track_id: string;
  state: "attended" | "holding" | "unattended";
  bbox: number[];
  confidence: number;
  dwell_seconds: number;
  hits: number;
  observed: boolean;
}

export type StreamMode = "hls" | "mjpeg";
export type SourceKind = "simulated" | "rtsp" | "http" | "file";

export interface Camera {
  id: number;
  name: string;
  location: string;
  rtsp_url: string;
  has_credentials: boolean;
  is_active: boolean;
  created_at: string;
  online: boolean;
  fps: number;
  latency_ms: number;
  person_count: number;
  active_threats: string[];
  bag_tracking: BagTrack[];
  is_simulated: boolean;
  source_kind: SourceKind;
  detector_profile: string;
  stream_mode: StreamMode;
  hls_ready: boolean;
  confidence_threshold: number | null;
  schedule: CameraSchedule;
  ab_profile: string | null;
  ab_share_pct: number;
  zones_count: number;
  turnstile: string | null;
}

export interface CameraSchedule {
  enabled?: boolean;
  days?: number[];
  start?: string;
  end?: string;
}

export type ZoneKind = "include" | "exclude";

export interface CameraZone {
  id?: number;
  camera_id?: number;
  name: string;
  kind: ZoneKind;
  color: string;
  points: number[][];
}

export interface CameraPolicy {
  camera_id: number;
  confidence_threshold: number | null;
  schedule: CameraSchedule;
  ab_profile: string | null;
  ab_share_pct: number;
  turnstile: string | null;
  profiles: string[];
  zones: CameraZone[];
}

export interface DetectorComponent {
  role: "coco" | "weapon" | "custom" | string;
  label: string;
  filename: string;
  exists: boolean;
  loaded: boolean;
  size_bytes: number;
  classes: string[];
  confidence_threshold: number;
  imgsz: number;
  architecture: string;
}

export interface DetectorProfile {
  key: string;
  label: string;
  description: string;
  components: string[];
  accent: string;
  cameras: number;
}

export type ThemeName = "dark" | "light" | "contrast";
export type AccentName = "emerald" | "indigo" | "sky" | "amber" | "rose";
export type KpiKey = "cameras" | "violations" | "critical" | "dwell" | "latency" | "confidence";

export interface Preferences {
  theme: ThemeName;
  accent: AccentName;
  kpis: KpiKey[];
  compact_tables: boolean;
  show_timeline: boolean;
  mobile_bottom_nav: boolean;
  sound_enabled: boolean;
  toasts_enabled: boolean;
  updated_at?: string | null;
}

export type PreferencesPatch = Partial<Omit<Preferences, "updated_at">>;

export interface SupportedArchitecture {
  key: string;
  label: string;
}

export interface UploadedModelInspection {
  architecture: string;
  task: string;
  classes: string[];
  num_classes: number;
  parameters: number;
  ultralytics_version: string;
  trained_at: string;
  train_model: string;
}

export interface ModelUploadResult {
  version: ModelVersion;
  inspection: UploadedModelInspection;
  activated: boolean;
  gate_passed: boolean | null;
  gate_notes: string;
  message: string;
}

export interface ModelCatalog {
  components: DetectorComponent[];
  profiles: DetectorProfile[];
  supported_architectures: SupportedArchitecture[];
  versions: ModelVersion[];
  production: ModelVersion | null;
  active_weights: string;
  reloaded_at: string;
  hls: {
    enabled: boolean;
    segment_sec: number;
    max_segments: number;
    ready_cameras: number[];
  };
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
  detected_at: string;
  track_id: string | null;
  dwell_seconds: number | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  is_false_alarm: boolean;
  acknowledged_latency_sec: number | null;
  zone_name: string | null;
  model_variant: string | null;
  notes: string;
}

export interface DashboardStats {
  total_cameras: number;
  active_cameras: number;
  total_violations: number;
  unacknowledged_violations: number;
  average_confidence: number;
  by_type: Record<string, number>;
  timeline: Array<{ label: string; count: number }>;
  tracking: {
    enabled: boolean;
    dwell_threshold_sec: number;
    avg_dwell_seconds: number;
    bag_tracks_active: number;
  };
  model: {
    active_weights: string;
    reloaded_at: string;
    avg_latency_ms: number;
    production_version: string | null;
    production_map50: number | null;
  };
}

export interface DatasetInfo {
  train_images: number;
  val_images: number;
  total_images: number;
  user_uploaded_images: number;
  class_annotations: Record<string, number>;
}

export type RetrainStatus = "queued" | "running" | "completed" | "failed" | "rejected";

export interface RetrainJob {
  id: number;
  status: RetrainStatus;
  epochs: number;
  current_epoch: number;
  progress_pct: number;
  dataset_yaml: string;
  metrics: Record<string, number>;
  details: string;
  created_at: string;
  completed_at: string | null;
  requested_by: string | null;
  baseline_map50: number | null;
  final_map50: number | null;
  validation_passed: boolean | null;
  version_id: number | null;
}

export interface ModelVersion {
  id: number;
  label: string;
  weights_path: string;
  metrics: Record<string, number>;
  map50: number | null;
  map50_95: number | null;
  baseline_map50: number | null;
  delta_map50: number | null;
  status: "candidate" | "production" | "rejected" | "archived";
  validation_passed: boolean | null;
  validation_notes: string;
  job_id: number | null;
  source: string;
  architecture: string;
  size_bytes: number;
  sha256: string;
  created_by: string;
  created_at: string;
  activated_at: string | null;
  is_current: boolean;
}

export interface ValidationGateInfo {
  tolerance: number;
  min_absolute_map50: number;
  production: ModelVersion | null;
  recent_rejections: Array<{
    id: number;
    label: string;
    map50: number | null;
    baseline_map50: number | null;
    notes: string;
    created_at: string;
  }>;
  active_weights: string;
  active_map50: number | null;
}

export interface AuditEntry {
  id: number;
  created_at: string;
  actor_username: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  outcome: "success" | "denied" | "failure";
  ip_address: string | null;
  user_agent: string | null;
  detail: string;
}

export interface AuditPage {
  total: number;
  items: AuditEntry[];
  actions: string[];
}

export interface AuditSummary {
  total: number;
  denied: number;
  today: number;
  by_action: Array<{ action: string; count: number }>;
}

export interface AnalyzeUploadResult {
  media_type: "image" | "video";
  result_url: string;
  violations: Array<{
    type: ViolationType;
    confidence: number;
    bbox: number[];
    track_id?: string;
    dwell_seconds?: number;
  }>;
  safe_objects: Array<{ kind: string; label: string; confidence: number; bbox: number[] }>;
  latency_ms?: number;
  frames_processed?: number;
  saved_violation_ids: number[];
}

export interface SystemStatus {
  version: string;
  project: string;
  auth: { scheme: string; cookie_name: string; demo_login: boolean };
  roles: { current: Role; permissions: string[] };
  tracking: {
    backend: string;
    dwell_threshold_sec: number;
    iou_threshold: number;
    max_age_sec: number;
    min_hits: number;
  };
  validation_gate: { map50_tolerance: number; map50_min_absolute: number };
  model: {
    active_weights: string;
    production_version: string | null;
    production_map50: number | null;
    reloaded_at: string;
  };
}

const API_BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const UNAUTHORIZED_EVENT = "school-security:unauthorized";

/**
 * Токен держим в памяти + sessionStorage.
 *
 * Основной транспорт — HttpOnly cookie. Но в iframe-превью (Live Preview, встраивание
 * на сторонний домен) браузер блокирует сторонние cookie: после логина все запросы
 * получали 401 и пользователя выбрасывало обратно на экран входа.
 * Поэтому дублируем JWT в заголовок Authorization, а для <img>/<video> — в ?token=.
 */
const TOKEN_STORAGE_KEY = "school_security_token";
let accessToken: string | null = readStoredToken();

function readStoredToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  try {
    if (token) window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // приватный режим / заблокированное хранилище — живём с токеном в памяти
  }
}

export function getAccessToken(): string | null {
  return accessToken ?? readStoredToken();
}

export function hasAccessToken(): boolean {
  return Boolean(getAccessToken());
}

/**
 * Добавляет ?token= к URL медиафайла — теги <img>/<video>/<a download>
 * не умеют отправлять Authorization-заголовок.
 */
export function withToken(url: string): string {
  const token = getAccessToken();
  if (!token || !url.startsWith("/")) return url;
  if (url.includes("token=")) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

/**
 * Режим передачи токена, который реально работает в текущем окружении:
 * - "bearer" — основной (заголовок Authorization);
 * - "query"  — запасной, если прокси/iframe вырезает заголовки: ?token=...
 * - "cookie" — токена ещё нет, полагаемся на HttpOnly cookie.
 */
let queryAuthMode = false;

export type AuthMode = "bearer" | "query" | "cookie";

export function getAuthMode(): AuthMode {
  if (queryAuthMode) return "query";
  return getAccessToken() ? "bearer" : "cookie";
}

function withQueryToken(url: string, token: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers(init?.headers);
  if (token && !queryAuthMode) headers.set("Authorization", `Bearer ${token}`);

  const baseUrl = `${API_BASE}${path}`;
  const url = token && queryAuthMode ? withQueryToken(baseUrl, token) : baseUrl;

  let res = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers,
  });

  // Прокси Live Preview иногда вырезает нестандартные заголовки: 401 при живом
  // токене. Пробуем тот же запрос с ?token= и, если помогло, запоминаем режим.
  if (res.status === 401 && token && !queryAuthMode) {
    const retry = await fetch(withQueryToken(baseUrl, token), {
      credentials: "same-origin",
      ...init,
      headers,
    });
    if (retry.status !== 401) {
      queryAuthMode = true;
      res = retry;
    }
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") {
        detail = data.detail;
      } else if (Array.isArray(data?.detail)) {
        detail = data.detail.map((d: { msg?: string }) => d.msg ?? "").join("; ") || detail;
      }
    } catch {
      // ignore parse error
    }
    if (res.status === 401 && !path.startsWith("/auth/")) {
      setAccessToken(null);
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(detail, res.status);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export const api = {
  // ── Аутентификация ──────────────────────────────────────────────────────
  login: (username: string, password: string, totpCode?: string) =>
    request<AuthSession>(
      "/auth/login",
      jsonInit("POST", { username, password, totp_code: totpCode || undefined })
    ),

  demoLogin: (username: string) =>
    request<AuthSession>("/auth/demo-login", jsonInit("POST", { username })),

  logout: () => request<{ status: string }>("/auth/logout", { method: "POST" }),

  me: () => request<User>("/auth/me"),

  demoAccounts: () => request<DemoAccount[]>("/auth/demo-accounts"),

  // ── Камеры и нарушения ──────────────────────────────────────────────────
  getStats: () => request<DashboardStats>("/stats"),

  getSystemStatus: () => request<SystemStatus>("/system/status"),

  getCameras: () => request<Camera[]>("/cameras"),

  addCamera: (payload: { name: string; location: string; rtsp_url: string }) =>
    request<Camera>("/cameras", jsonInit("POST", payload)),

  toggleCamera: (id: number) => request<Camera>(`/cameras/${id}/toggle`, { method: "POST" }),

  setCameraDetector: (id: number, profile: string) =>
    request<Camera>(`/cameras/${id}/detector`, jsonInit("PATCH", { profile })),

  getDetectorProfiles: () => request<{ profiles: DetectorProfile[] }>("/detector/profiles"),

  getModelCatalog: () => request<ModelCatalog>("/models/catalog"),

  deleteCamera: (id: number) => request<void>(`/cameras/${id}`, { method: "DELETE" }),

  simulateEvent: (
    cameraId: number,
    scenario: "suspicious_bag" | "dog" | "weapon" | "person_with_bag"
  ) =>
    request<{ status: string }>(`/cameras/${cameraId}/simulate`, jsonInit("POST", { scenario })),

  getViolations: (params?: {
    violation_type?: string;
    camera_id?: number;
    unacknowledged_only?: boolean;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.violation_type) q.set("violation_type", params.violation_type);
    if (params?.camera_id) q.set("camera_id", String(params.camera_id));
    if (params?.unacknowledged_only) q.set("unacknowledged_only", "true");
    if (params?.limit) q.set("limit", String(params.limit));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return request<Violation[]>(`/violations${suffix}`);
  },

  getViolationsPage: (params?: {
    violation_type?: string;
    camera_id?: number;
    unacknowledged_only?: boolean;
    false_alarm?: boolean;
    date_from?: string;
    date_to?: string;
    search?: string;
    sort?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.violation_type) q.set("violation_type", params.violation_type);
    if (params?.camera_id) q.set("camera_id", String(params.camera_id));
    if (params?.unacknowledged_only) q.set("unacknowledged_only", "true");
    if (params?.false_alarm !== undefined) q.set("false_alarm", String(params.false_alarm));
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    if (params?.search) q.set("search", params.search);
    if (params?.sort) q.set("sort", params.sort);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return request<ViolationPage>(`/violations/page${suffix}`);
  },

  acknowledgeViolation: (id: number) =>
    request<Violation>(`/violations/${id}/ack`, { method: "PATCH" }),

  setFalseAlarm: (id: number, isFalseAlarm: boolean, notes?: string) =>
    request<Violation>(
      `/violations/${id}/false-alarm`,
      jsonInit("PATCH", { is_false_alarm: isFalseAlarm, notes })
    ),

  violationSnapshotUrl: (
    id: number,
    options?: { watermark?: boolean; blurFaces?: boolean; download?: boolean }
  ) => {
    const q = new URLSearchParams();
    q.set("watermark", String(options?.watermark ?? true));
    q.set("blur_faces", String(options?.blurFaces ?? false));
    if (options?.download) q.set("download", "true");
    return withToken(`/api/violations/${id}/snapshot?${q.toString()}`);
  },

  addViolationToDataset: (id: number) =>
    request<{ status: string; filename: string; violation_type: string }>(
      `/violations/${id}/to-dataset`,
      { method: "POST" }
    ),

  getCameraZones: (cameraId: number) =>
    request<{ camera_id: number; zones: CameraZone[] }>(`/cameras/${cameraId}/zones`),

  saveCameraZones: (cameraId: number, zones: CameraZone[]) =>
    request<{ camera_id: number; zones: CameraZone[] }>(
      `/cameras/${cameraId}/zones`,
      jsonInit("PUT", { zones })
    ),

  getCameraPolicy: (cameraId: number) =>
    request<CameraPolicy>(`/cameras/${cameraId}/policy`),

  updateCameraPolicy: (
    cameraId: number,
    payload: {
      confidence_threshold?: number | null;
      schedule?: CameraSchedule;
      ab_profile?: string | null;
      ab_share_pct?: number;
      turnstile?: string | null;
    }
  ) => request<CameraPolicy>(`/cameras/${cameraId}/policy`, jsonInit("PATCH", payload)),

  deleteViolation: (id: number) => request<void>(`/violations/${id}`, { method: "DELETE" }),

  violationsExportUrl: (params?: {
    violation_type?: string;
    camera_id?: number;
    unacknowledged_only?: boolean;
    false_alarm?: boolean;
    date_from?: string;
    date_to?: string;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.violation_type) q.set("violation_type", params.violation_type);
    if (params?.camera_id) q.set("camera_id", String(params.camera_id));
    if (params?.unacknowledged_only) q.set("unacknowledged_only", "true");
    if (params?.false_alarm !== undefined) q.set("false_alarm", String(params.false_alarm));
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    if (params?.limit) q.set("limit", String(params.limit));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return withToken(`/api/violations/export${suffix}`);
  },

  reportUrl: (
    format: "pdf" | "xlsx",
    params?: { date_from?: string; date_to?: string; camera_id?: number; violation_type?: string }
  ) => {
    const q = new URLSearchParams();
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    if (params?.camera_id) q.set("camera_id", String(params.camera_id));
    if (params?.violation_type) q.set("violation_type", params.violation_type);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return withToken(`/api/analytics/reports/incidents.${format}${suffix}`);
  },

  slaReportUrl: (days = 7) => withToken(`/api/analytics/reports/sla.pdf?days=${days}`),

  getSla: (days = 7, cameraId?: number) =>
    request<SlaReport>(
      `/analytics/sla?days=${days}${cameraId ? `&camera_id=${cameraId}` : ""}`
    ),

  getHeatmap: (days = 30) => request<HeatmapReport>(`/analytics/heatmap?days=${days}`),

  getAbStats: (days = 30) => request<AbReport>(`/analytics/ab?days=${days}`),

  getQuality: (days = 30) => request<QualityReport>(`/analytics/quality?days=${days}`),

  reportPreview: (params?: { date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return request<ReportPreview>(`/analytics/reports/preview${suffix}`);
  },

  getEventsRecent: (limit = 30) => request<{ items: LiveEvent[]; total: number; emergency: EmergencyState }>(`/events/recent?limit=${limit}`),

  eventsStreamUrl: () => withToken("/api/events/stream"),

  videoDownloadUrl: (violation: { id: number }) =>
    withToken(`/api/violations/${violation.id}/video?download=true`),

  streamUrl: (cameraId: number) => withToken(`/api/cameras/${cameraId}/stream`),

  // HLS-плейлист: hls.js сам запросит сегменты рядом с ним
  hlsUrl: (cameraId: number) => `${API_BASE}/cameras/${cameraId}/hls/index.m3u8`,

  /**
   * Авторизация XHR-запросов hls.js: тег <video> не умеет отправлять заголовки,
   * а сегменты HLS грузятся через XHR, поэтому токен добавляем вручную.
   */
  authorizeXhr: (xhr: XMLHttpRequest, url: string) => {
    const token = getAccessToken();
    if (!token) return;
    // Токен кладём и в заголовок, и в URL: если превью-прокси вырежет
    // Authorization, запрос за плейлистом/сегментом всё равно авторизуется.
    const target = url.includes("token=")
      ? url
      : `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
    xhr.open("GET", target, true);
    if (!queryAuthMode) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }
  },

  cameraSnapshotUrl: (cameraId: number) => withToken(`/api/cameras/${cameraId}/snapshot`),

  mediaUrl: (path: string) => withToken(path),

  // ── Медиа-лаборатория ───────────────────────────────────────────────────
  analyzeMedia: (file: File, saveViolation: boolean) => {
    const form = new FormData();
    form.append("file", file);
    form.append("save_violation", String(saveViolation));
    return request<AnalyzeUploadResult>("/analyze/upload", { method: "POST", body: form });
  },

  // ── Дообучение и реестр версий ──────────────────────────────────────────
  getDatasetInfo: () => request<DatasetInfo>("/models/dataset"),

  uploadDatasetSample: (file: File, violationType: ViolationType) => {
    const form = new FormData();
    form.append("file", file);
    form.append("violation_type", violationType);
    return request<{ status: string; filename: string; dataset: DatasetInfo }>(
      "/models/dataset/upload",
      { method: "POST", body: form }
    );
  },

  getRetrainJobs: () => request<RetrainJob[]>("/models/jobs"),

  retrainModel: (epochs: number, datasetYaml = "ml/datasets/school_security.yaml") =>
    request<RetrainJob>("/models/retrain", jsonInit("POST", { epochs, dataset_yaml: datasetYaml })),

  getModelVersions: () => request<ModelVersion[]>("/models/versions"),

  uploadModel: (payload: {
    file: File;
    label?: string;
    architecture?: string;
    map50?: number | null;
    activate?: boolean;
    notes?: string;
  }) => {
    const form = new FormData();
    form.append("file", payload.file);
    form.append("label", payload.label ?? "");
    form.append("architecture", payload.architecture ?? "auto");
    if (payload.map50 !== null && payload.map50 !== undefined && !Number.isNaN(payload.map50)) {
      form.append("map50", String(payload.map50));
    }
    form.append("activate", String(Boolean(payload.activate)));
    form.append("notes", payload.notes ?? "");
    return request<ModelUploadResult>("/models/upload", { method: "POST", body: form });
  },

  deleteModelVersion: (versionId: number) =>
    request<void>(`/models/versions/${versionId}`, { method: "DELETE" }),

  getValidationGate: () => request<ValidationGateInfo>("/models/gate"),

  rollbackVersion: (versionId: number, reason: string, force = false) =>
    request<ModelVersion>(
      `/models/versions/${versionId}/rollback`,
      jsonInit("POST", { reason, force })
    ),

  // ── Персональные настройки интерфейса ───────────────────────────────────
  getPreferences: () => request<Preferences>("/settings/preferences"),

  updatePreferences: (payload: PreferencesPatch) =>
    request<Preferences>("/settings/preferences", jsonInit("PATCH", payload)),

  // ── Пользователи ────────────────────────────────────────────────────────
  getUsers: () => request<User[]>("/users"),

  createUser: (payload: { username: string; password: string; full_name: string; role: Role }) =>
    request<User>("/users", jsonInit("POST", payload)),

  updateUser: (
    id: number,
    payload: { full_name?: string; role?: Role; is_active?: boolean; password?: string }
  ) => request<User>(`/users/${id}`, jsonInit("PATCH", payload)),

  deleteUser: (id: number) => request<void>(`/users/${id}`, { method: "DELETE" }),

  // ── Аудит ───────────────────────────────────────────────────────────────
  getAudit: (params?: {
    action?: string;
    actor?: string;
    outcome?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.action) q.set("action", params.action);
    if (params?.actor) q.set("actor", params.actor);
    if (params?.outcome) q.set("outcome", params.outcome);
    if (params?.search) q.set("search", params.search);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return request<AuditPage>(`/audit${suffix}`);
  },

  getAuditSummary: () => request<AuditSummary>("/audit/summary"),

  get auditExportUrl() {
    return withToken("/api/audit/export");
  },

  // ── Экспорт ONNX / TensorRT ─────────────────────────────────────────────
  listModelExports: () => request<ModelExports>("/models/exports"),

  exportModelVersion: (versionId: number, format: "onnx" | "engine" = "onnx") =>
    request<{ status: string; filename: string; size_mb: number; download_url: string }>(
      `/models/versions/${versionId}/export?format=${format}`,
      { method: "POST" }
    ),

  // ── Эксплуатация ────────────────────────────────────────────────────────
  getOpsOverview: () => request<OpsOverview>("/ops/overview"),

  getRetention: () => request<RetentionPolicy>("/ops/retention"),

  updateRetention: (payload: { days?: number; max_gb?: number; auto_clean?: boolean }) =>
    request<RetentionPolicy>("/ops/retention", jsonInit("PUT", payload)),

  runRetentionCleanup: () => request<RetentionCleanup>("/ops/retention/cleanup", { method: "POST" }),

  getBackups: () => request<BackupListing>("/ops/backups"),

  createBackup: () => request<BackupItem>("/ops/backups", { method: "POST" }),

  restoreBackup: (filename: string, confirm: string) =>
    request<{ status: string; source: string; safety_copy: string }>(
      "/ops/backups/restore",
      jsonInit("POST", { filename, confirm })
    ),

  getWatchdog: () => request<WatchdogStatus>("/ops/watchdog"),

  getNotifications: () => request<NotificationSettings>("/ops/notifications"),

  updateNotifications: (payload: Partial<NotificationSettings>) =>
    request<NotificationSettings>("/ops/notifications", jsonInit("PUT", payload)),

  testNotifications: () =>
    request<{ sent: boolean; error: string | null; results: { chat_id: string; sent: boolean }[] }>(
      "/ops/notifications/test",
      { method: "POST" }
    ),

  getEmergency: () => request<EmergencyState>("/ops/emergency"),

  setEmergency: (active: boolean, reason: string) =>
    request<EmergencyState>("/ops/emergency", jsonInit("POST", { active, reason })),

  metricsUrl: () => withToken("/api/ops/metrics"),

  // ── Безопасность учётных записей ────────────────────────────────────────
  getSecurityOverview: () => request<SecurityOverview>("/security/overview"),

  setCameraScope: (userId: number, cameraIds: number[]) =>
    request<{ user_id: number; camera_ids: number[]; user: User }>(
      `/security/users/${userId}/camera-scope`,
      jsonInit("PUT", { camera_ids: cameraIds })
    ),

  resetUserTwoFactor: (userId: number) =>
    request<{ status: string; user: User }>(`/security/users/${userId}/2fa/reset`, { method: "POST" }),

  unlockUser: (userId: number) =>
    request<{ status: string; user: User }>(`/security/users/${userId}/unlock`, { method: "POST" }),

  twoFactorStatus: () => request<{ enabled: boolean; recovery_codes_left: number }>("/auth/2fa/status"),

  setupTwoFactor: () =>
    request<{ secret: string; otpauth_uri: string; recovery_codes: string[]; issuer: string }>(
      "/auth/2fa/setup",
      { method: "POST" }
    ),

  enableTwoFactor: (code: string) =>
    request<{ status: string; enabled: boolean }>("/auth/2fa/enable", jsonInit("POST", { code })),

  disableTwoFactor: (currentPassword: string) =>
    request<{ status: string; enabled: boolean }>(
      "/auth/2fa/disable",
      jsonInit("POST", { current_password: currentPassword })
    ),

  // ── СКУД и посетители ───────────────────────────────────────────────────
  getAccessEvents: (params?: {
    date?: string;
    direction?: string;
    kind?: string;
    late_only?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.date) q.set("date", params.date);
    if (params?.direction) q.set("direction", params.direction);
    if (params?.kind) q.set("kind", params.kind);
    if (params?.late_only) q.set("late_only", "true");
    if (params?.search) q.set("search", params.search);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return request<AccessEventPage>(`/access/events${suffix}`);
  },

  getAccessSummary: (date?: string) =>
    request<AccessSummary>(`/access/summary${date ? `?date=${date}` : ""}`),

  importAccessEvents: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ created: number; errors: string[] }>("/access/import", {
      method: "POST",
      body: form,
    });
  },

  simulateAccessEvents: (count = 18) =>
    request<{ created: number }>(`/access/simulate?count=${count}`, { method: "POST" }),

  getVisitors: (params?: { status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return request<{ items: VisitorPass[]; total: number }>(`/visitors${suffix}`);
  },

  getVisitorSummary: () => request<VisitorSummary>("/visitors/summary"),

  createVisitor: (payload: {
    full_name: string;
    organization?: string;
    purpose?: string;
    host?: string;
    phone?: string;
    valid_hours?: number;
    notes?: string;
  }) => request<VisitorPass>("/visitors", jsonInit("POST", payload)),

  visitorAction: (id: number, action: "check-in" | "check-out" | "cancel") =>
    request<VisitorPass>(`/visitors/${id}/${action}`, { method: "POST" }),

  deleteVisitor: (id: number) => request<void>(`/visitors/${id}`, { method: "DELETE" }),
};


// ─── v3: типы аналитики, эксплуатации, СКУД и событий ───────────────────────

export interface ViolationPage {
  items: Violation[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  summary: {
    total: number;
    acknowledged: number;
    false_alarms: number;
    avg_latency_sec: number | null;
  };
}

export interface SlaReport {
  period_days: number;
  target_sec: number;
  total: number;
  measured: number;
  pending: number;
  pending_oldest_sec: number;
  avg_latency_sec: number | null;
  median_latency_sec: number | null;
  p95_latency_sec: number | null;
  overdue_count: number;
  overdue: {
    id: number;
    camera_name: string;
    violation_type: string;
    detected_at: string;
    latency_sec: number;
    acknowledged_by: string | null;
  }[];
  by_guard: {
    guard: string;
    count: number;
    avg_sec: number;
    median_sec: number;
    overdue: number;
  }[];
  by_shift: Record<
    "day" | "night",
    { label: string; count: number; avg: number | null; median: number | null; p95: number | null; overdue: number }
  >;
}

export interface HeatmapReport {
  period_days: number;
  weekday_labels: string[];
  hours: number[];
  matrix: number[][];
  max_value: number;
  by_type: Record<string, number>;
  top_cameras: { camera: string; count: number }[];
  false_alarm_total: number;
  false_alarm_rate: number;
  top_false_alarm_cameras: { camera: string; false_alarms: number; total: number; rate: number }[];
}

export interface AbReport {
  period_days: number;
  variants: {
    variant: string;
    count: number;
    avg_confidence: number | null;
    false_alarms: number;
    acknowledged: number;
    avg_latency_sec: number | null;
  }[];
  cameras: {
    camera_id: number;
    camera_name: string;
    profile_a: string;
    profile_b: string | null;
    share_b: number;
  }[];
}

export interface QualityReport {
  period_days: number;
  total: number;
  false_alarms: number;
  false_alarm_rate: number;
  acknowledged: number;
  ack_rate: number;
  avg_confidence: number | null;
  median_confidence: number | null;
}

export interface ReportPreview {
  period: string;
  summary: {
    total: number;
    by_type: Record<string, number>;
    acknowledged: number;
    false_alarms: number;
    latency_avg: number | null;
    latency_median: number | null;
    sla_target_sec: number;
    sla_overdue: number;
    top_cameras: [string, number][];
  };
  sample: Violation[];
  watermark: string;
}

export interface EmergencyState {
  active: boolean;
  reason: string;
  started_at: string | null;
  started_by: string | null;
  cleared_at: string | null;
  cleared_by: string | null;
}

export interface LiveEvent {
  id: number;
  type: string;
  ts: string;
  payload: Record<string, unknown>;
}

export interface ModelExports {
  formats: Record<string, string>;
  items: { filename: string; size_mb: number; created_at: string; download_url: string }[];
}

export interface RetentionPolicy {
  days: number;
  max_gb: number;
  auto_clean: boolean;
  last_run_at: string | null;
  last_result: RetentionCleanup | null;
  usage_mb: number;
  quota_mb: number;
  violations: number;
}

export interface RetentionCleanup {
  deleted_expired: number;
  deleted_by_quota: number;
  deleted_orphans: number;
  usage_mb: number;
  free_quota_mb: number;
  keep_days: number;
  max_gb: number;
  duration_sec: number;
  ran_at: string;
}

export interface BackupItem {
  filename: string;
  size_bytes: number;
  size_mb: number;
  created_at: string;
  engine?: string;
}

export interface BackupListing {
  dir: string;
  database: "sqlite" | "postgresql";
  items: BackupItem[];
  keep: number;
}

export interface WatchdogStatus {
  enabled: boolean;
  interval_sec: number;
  stale_sec: number;
  last_run: string | null;
  last_actions: Record<string, unknown>[];
  workers: {
    camera_id: number;
    name: string;
    online: boolean;
    paused: boolean;
    fps: number;
    last_frame_age_sec: number;
    variant: string;
    profile: string;
  }[];
}

export interface NotificationSettings {
  enabled: boolean;
  bot_token: string;
  bot_token_set?: boolean;
  director_chat_id: string;
  guard_chat_id: string;
  notify_weapon: boolean;
  notify_bag: boolean;
  notify_dog: boolean;
  notify_offline: boolean;
  notify_emergency: boolean;
  updated_at: string | null;
  last_error: string | null;
  last_sent_at: string | null;
  status?: { sent_count: number; last_sent_at: string | null; last_error: string | null; polling: boolean };
}

export interface OpsOverview {
  version: string;
  database: { engine: string; size_mb: number | null; violations: number; cameras: number };
  media: { usage_mb: number; quota_mb: number; root: string };
  retention: RetentionPolicy;
  backups: { count: number; dir: string; latest: number | null };
  events: { subscribers: number; published: number };
  metrics: { enabled: boolean; path: string };
  watchdog: { enabled: boolean; last_run: string | null };
  workers: WatchdogStatus["workers"];
}

export interface SecurityOverview {
  users_total: number;
  users_with_2fa: number;
  users_restricted: number;
  cameras_total: number;
  locked_accounts: { username: string; locked_until: string | null }[];
  password_policy: {
    min_length: number;
    requires_upper: boolean;
    requires_lower: boolean;
    requires_digit: boolean;
    lockout_attempts: number;
    lockout_minutes: number;
    rate_limit_attempts: number;
    rate_limit_window_sec: number;
  };
  recent_failures: { created_at: string; actor: string | null; action: string; ip: string | null }[];
  recent_exports: { created_at: string; actor: string | null; action: string; detail: string }[];
}

export interface AccessEvent {
  id: number;
  occurred_at: string;
  person_name: string;
  person_kind: "student" | "teacher" | "staff" | "visitor";
  person_kind_label: string;
  class_name: string;
  turnstile: string;
  direction: "in" | "out";
  direction_label: string;
  is_late: boolean;
  card_id: string;
  source: string;
}

export interface AccessEventPage {
  date: string;
  total: number;
  items: AccessEvent[];
  limit: number;
  offset: number;
}

export interface AccessSummary {
  date: string;
  events: number;
  entries: number;
  exits: number;
  inside_now: number;
  late_students: number;
  late_list: AccessEvent[];
  by_kind: Record<string, number>;
  hourly: number[];
  turnstiles: { name: string; count: number }[];
  school_start: string;
  late_grace_min: number;
}

export interface VisitorPass {
  id: number;
  full_name: string;
  organization: string;
  purpose: string;
  host: string;
  badge_no: string;
  phone: string;
  valid_from: string;
  valid_to: string;
  status: "expected" | "inside" | "left" | "expired" | "cancelled";
  checked_in_at: string | null;
  checked_out_at: string | null;
  created_by: string;
  notes: string;
  created_at: string;
}

export interface VisitorSummary {
  total: number;
  expected_today: number;
  inside: number;
  left_today: number;
  expired: number;
  overdue: number;
  inside_list: VisitorPass[];
}
