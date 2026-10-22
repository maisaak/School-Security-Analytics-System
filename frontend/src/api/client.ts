export type ViolationType = "weapon" | "suspicious_bag" | "dog";

export interface Camera {
  id: number;
  name: string;
  location: string;
  rtsp_url: string;
  is_active: boolean;
  created_at: string;
  online: boolean;
  fps: number;
  latency_ms: number;
  person_count: number;
  active_threats: string[];
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
}

export interface DashboardStats {
  total_cameras: number;
  active_cameras: number;
  total_violations: number;
  unacknowledged_violations: number;
  average_confidence: number;
  by_type: Record<string, number>;
  timeline: Array<{ label: string; count: number }>;
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
  status: "queued" | "running" | "completed" | "failed";
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
}

const API_BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.detail) detail = data.detail;
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

  getViolations: (params?: {
    violation_type?: string;
    camera_id?: number;
    unacknowledged_only?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params?.violation_type) q.set("violation_type", params.violation_type);
    if (params?.camera_id) q.set("camera_id", String(params.camera_id));
    if (params?.unacknowledged_only) q.set("unacknowledged_only", "true");
    const suffix = q.toString() ? `?${q.toString()}` : "";
    return request<Violation[]>(`/violations${suffix}`);
  },

  acknowledgeViolation: (id: number) =>
    request<Violation>(`/violations/${id}/ack`, { method: "PATCH" }),

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
    request<RetrainJob>("/models/retrain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ epochs, dataset_yaml: datasetYaml }),
    }),
};
