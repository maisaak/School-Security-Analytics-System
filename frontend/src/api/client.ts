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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "same-origin",
    ...init,
  });

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
  login: (username: string, password: string) =>
    request<AuthSession>("/auth/login", jsonInit("POST", { username, password })),

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

  acknowledgeViolation: (id: number) =>
    request<Violation>(`/violations/${id}/ack`, { method: "PATCH" }),

  deleteViolation: (id: number) => request<void>(`/violations/${id}`, { method: "DELETE" }),

  videoDownloadUrl: (violation: { id: number }) => `/api/violations/${violation.id}/video?download=true`,

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

  getValidationGate: () => request<ValidationGateInfo>("/models/gate"),

  rollbackVersion: (versionId: number, reason: string, force = false) =>
    request<ModelVersion>(
      `/models/versions/${versionId}/rollback`,
      jsonInit("POST", { reason, force })
    ),

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

  auditExportUrl: "/api/audit/export",
};
