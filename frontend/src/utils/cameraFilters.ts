import type { Camera } from "../api/client";

export type CameraFilter = "all" | "online" | "offline" | "threats";

export function matchesCameraFilter(camera: Camera, filter: CameraFilter): boolean {
  if (filter === "online") return camera.is_active && camera.online;
  if (filter === "offline") return camera.is_active && !camera.online;
  if (filter === "threats") return camera.is_active && camera.active_threats.length > 0;
  return true;
}

export function filterCameras(cameras: Camera[], query: string, filter: CameraFilter): Camera[] {
  const search = query.trim().toLocaleLowerCase("ru-RU");
  return cameras.filter(camera => matchesCameraFilter(camera, filter) &&
    (!search || `${camera.name} ${camera.location}`.toLocaleLowerCase("ru-RU").includes(search)));
}
