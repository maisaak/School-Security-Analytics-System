from __future__ import annotations

import math
import threading
import time
from datetime import datetime
from pathlib import Path
import cv2
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont
from ultralytics import YOLO

torch.set_num_threads(2)

from app.core.config import PROJECT_ROOT, settings
from app.core.detector_profiles import (
    COMPONENT_LABELS,
    COMPONENT_ORDER,
    normalize_profile,
    profile_catalog,
    profile_components,
)


def _load_unicode_font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates: list[Path] = []
    try:
        import matplotlib
        mpl_font_dir = Path(matplotlib.get_data_path()) / "fonts" / "ttf"
        candidates.append(mpl_font_dir / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"))
    except Exception:
        pass
    candidates.extend([
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ])
    for path in candidates:
        if path.is_file():
            try:
                return ImageFont.truetype(str(path), size=size)
            except Exception:
                continue
    return ImageFont.load_default()


FONT_BADGE = _load_unicode_font(15, bold=True)
FONT_HUD = _load_unicode_font(14, bold=True)

THREAT_META = {
    "weapon": {
        "ru": "ОРУЖИЕ · ТРЕВОГА",
        "rgb": (239, 68, 68),
        "bgr": (68, 68, 239),
        "priority": 3,
    },
    "suspicious_bag": {
        "ru": "БЕСХОЗНАЯ СУМКА",
        "rgb": (245, 158, 11),
        "bgr": (11, 158, 245),
        "priority": 2,
    },
    "dog": {
        "ru": "СОБАКА НА ТЕРРИТОРИИ",
        "rgb": (249, 115, 22),
        "bgr": (22, 115, 249),
        "priority": 1,
    },
}


def _compute_iou(a: list[int], b: list[int]) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(1, (a[2] - a[0]) * (a[3] - a[1]))
    area_b = max(1, (b[2] - b[0]) * (b[3] - b[1]))
    return inter / float(area_a + area_b - inter)


class ViolationDetector:
    """
    Многомодельный ансамбль YOLOv8 (Ultralytics):
    1. COCO YOLOv8n (`person`, `dog`, `backpack`, `handbag`, `suitcase`, `knife`)
    2. Специализированная модель оружия (`guns`, `knife`)
    3. Дообучаемая кастомная модель школы (`dog`, `weapon`, `suspicious_bag`)
    Поддерживает пространственную проверку «владелец рядом» и горячую перезагрузку весов.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.coco_model = YOLO(str(settings.YOLO_COCO_MODEL_PATH))
        self.weapon_model = (
            YOLO(str(settings.YOLO_WEAPON_MODEL_PATH))
            if Path(settings.YOLO_WEAPON_MODEL_PATH).is_file()
            else None
        )
        self.custom_model = (
            YOLO(str(settings.YOLO_CUSTOM_MODEL_PATH))
            if Path(settings.YOLO_CUSTOM_MODEL_PATH).is_file()
            else None
        )
        self.active_weights_name = (
            Path(settings.YOLO_CUSTOM_MODEL_PATH).name
            if self.custom_model is not None
            else Path(settings.YOLO_COCO_MODEL_PATH).name
        )
        self._custom_mtime: float = (
            Path(settings.YOLO_CUSTOM_MODEL_PATH).stat().st_mtime
            if Path(settings.YOLO_CUSTOM_MODEL_PATH).is_file()
            else 0.0
        )
        self._last_mtime_check: float = time.monotonic()
        self.reloaded_at: str = datetime.now().isoformat(timespec="seconds")

    def _maybe_reload_from_disk(self) -> None:
        """Автоматически подхватывает обновлённые веса, если обучение завершилось во внешнем процессе Celery."""
        now = time.monotonic()
        if now - self._last_mtime_check < 2.0:
            return
        self._last_mtime_check = now
        custom_path = Path(settings.YOLO_CUSTOM_MODEL_PATH)
        if not custom_path.is_file():
            return
        mtime = custom_path.stat().st_mtime
        if mtime > self._custom_mtime:
            self.reload_custom_weights(custom_path)

    # ── Каталог моделей для админ-панели ─────────────────────────────────────
    def _component_entry(self, role: str, model, path: Path, conf: float, imgsz: int) -> dict:
        exists = path.is_file()
        classes: list[str] = []
        if model is not None:
            try:
                classes = sorted({str(v) for v in dict(model.names).values()})
            except Exception:
                classes = []
        return {
            "role": role,
            "label": COMPONENT_LABELS.get(role, role),
            "filename": path.name,
            "exists": exists,
            "loaded": model is not None,
            "size_bytes": path.stat().st_size if exists else 0,
            "classes": classes,
            "confidence_threshold": conf,
            "imgsz": imgsz,
            "architecture": "YOLOv8",
        }

    def describe_components(self) -> list[dict]:
        """Состав ансамбля: какие веса реально загружены и что они умеют детектировать."""
        with self._lock:
            return [
                self._component_entry(
                    "coco",
                    self.coco_model,
                    Path(settings.YOLO_COCO_MODEL_PATH),
                    settings.CONFIDENCE_THRESHOLD,
                    480,
                ),
                self._component_entry(
                    "weapon",
                    self.weapon_model,
                    Path(settings.YOLO_WEAPON_MODEL_PATH),
                    settings.WEAPON_CONFIDENCE_THRESHOLD,
                    480,
                ),
                self._component_entry(
                    "custom",
                    self.custom_model,
                    Path(settings.YOLO_CUSTOM_MODEL_PATH),
                    settings.CUSTOM_CONFIDENCE_THRESHOLD,
                    416,
                ),
            ]

    def describe_catalog(self, camera_counts: dict[str, int] | None = None) -> dict:
        return {
            "components": self.describe_components(),
            "profiles": profile_catalog(camera_counts),
            "active_weights": self.active_weights_name,
            "reloaded_at": self.reloaded_at,
        }

    def reload_custom_weights(self, weights_path: str | Path | None = None) -> None:
        target = Path(weights_path) if weights_path else Path(settings.YOLO_CUSTOM_MODEL_PATH)
        if not target.is_absolute():
            target = (PROJECT_ROOT / target).resolve()
        if not target.is_file():
            return
        loaded = YOLO(str(target))
        mtime = target.stat().st_mtime
        with self._lock:
            self.custom_model = loaded
            self._custom_mtime = mtime
            self.active_weights_name = target.name
            self.reloaded_at = datetime.now().isoformat(timespec="seconds")

    def detect_frame(self, frame: np.ndarray, profile: str = "ensemble") -> dict:
        """
        Прогон кадра через выбранный профиль детекции.

        profile: ключ из DETECTOR_PROFILES (ensemble | custom | custom_weapon | coco | weapon).
        Набор реально запускаемых моделей определяется профилем — админ может
        снизить нагрузку на CPU, оставив только нужные детекторы.
        """
        self._maybe_reload_from_disk()
        components = profile_components(profile)
        use_coco = "coco" in components
        use_weapon = "weapon" in components and self.weapon_model is not None
        use_custom = "custom" in components and self.custom_model is not None

        t0 = time.perf_counter()
        h, w = frame.shape[:2]
        diag = math.hypot(w, h)

        person_boxes: list[tuple[float, list[int]]] = []
        bag_candidates: list[tuple[float, list[int]]] = []
        dog_candidates: list[tuple[float, list[int]]] = []
        weapon_candidates: list[tuple[float, list[int]]] = []

        with self._lock:
            coco_res = (
                self.coco_model.predict(
                    frame,
                    imgsz=480,
                    conf=settings.CONFIDENCE_THRESHOLD,
                    verbose=False,
                )[0]
                if use_coco
                else None
            )
            weapon_res = (
                self.weapon_model.predict(
                    frame,
                    imgsz=480,
                    conf=settings.WEAPON_CONFIDENCE_THRESHOLD,
                    verbose=False,
                )[0]
                if use_weapon
                else None
            )
            custom_res = (
                self.custom_model.predict(
                    frame,
                    imgsz=416,
                    conf=settings.CUSTOM_CONFIDENCE_THRESHOLD,
                    verbose=False,
                )[0]
                if use_custom
                else None
            )

        for box in (coco_res.boxes if coco_res is not None else []):
            cls_id = int(box.cls[0])
            label = str(coco_res.names.get(cls_id, "")).lower()
            conf = float(box.conf[0])
            xyxy = [int(v) for v in box.xyxy[0].tolist()]

            if label == "person":
                person_boxes.append((conf, xyxy))
            elif label == "dog":
                dog_candidates.append((conf, xyxy))
            elif label in {"backpack", "handbag", "suitcase"}:
                bag_candidates.append((conf, xyxy))
            elif label == "knife" and conf >= settings.WEAPON_CONFIDENCE_THRESHOLD:
                weapon_candidates.append((conf, xyxy))

        if weapon_res is not None:
            for box in weapon_res.boxes:
                cls_id = int(box.cls[0])
                label = str(weapon_res.names.get(cls_id, "")).lower()
                conf = float(box.conf[0])
                xyxy = [int(v) for v in box.xyxy[0].tolist()]
                bw_ratio = (xyxy[2] - xyxy[0]) / max(1.0, float(w))
                bh_ratio = (xyxy[3] - xyxy[1]) / max(1.0, float(h))
                # Отсекаем ложные крупногабаритные фоновые рамки на весь экран
                if label in {"guns", "gun", "pistol", "rifle", "knife", "weapon"} and bw_ratio < 0.72 and bh_ratio < 0.72:
                    weapon_candidates.append((conf, xyxy))

        if custom_res is not None:
            for box in custom_res.boxes:
                cls_id = int(box.cls[0])
                label = str(custom_res.names.get(cls_id, "")).lower()
                conf = float(box.conf[0])
                xyxy = [int(v) for v in box.xyxy[0].tolist()]
                if label == "dog":
                    dog_candidates.append((conf, xyxy))
                elif label == "weapon":
                    weapon_candidates.append((conf, xyxy))
                elif label == "suspicious_bag":
                    bag_candidates.append((conf, xyxy))

        def _dedupe(items: list[tuple[float, list[int]]]) -> list[tuple[float, list[int]]]:
            items_sorted = sorted(items, key=lambda x: x[0], reverse=True)
            kept: list[tuple[float, list[int]]] = []
            for conf, box in items_sorted:
                if all(_compute_iou(box, prev_box) < 0.42 for _, prev_box in kept):
                    kept.append((conf, box))
            return kept

        person_boxes = _dedupe(person_boxes)
        dog_candidates = _dedupe(dog_candidates)
        weapon_candidates = _dedupe(weapon_candidates)
        bag_candidates = _dedupe(bag_candidates)

        person_centers = [((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0) for _, b in person_boxes]

        violations: list[dict] = []
        safe_objects: list[dict] = []

        for conf, box in person_boxes:
            safe_objects.append({"kind": "person", "label": f"ЧЕЛОВЕК {conf:.0%}", "confidence": round(conf, 4), "bbox": box})

        for conf, box in weapon_candidates:
            violations.append({"type": "weapon", "confidence": round(conf, 4), "bbox": box})

        for conf, box in dog_candidates:
            # Исключаем дублирование, если в том же месте уже сработал детектор другого класса с высоким IoU
            violations.append({"type": "dog", "confidence": round(conf, 4), "bbox": box})

        for conf, box in bag_candidates:
            cx, cy = (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0
            owner_near = any(
                math.hypot(cx - px, cy - py) <= diag * settings.UNATTENDED_DISTANCE_RATIO
                for px, py in person_centers
            )
            if owner_near:
                safe_objects.append(
                    {
                        "kind": "attended_bag",
                        "label": f"РЮКЗАК · ВЛАДЕЛЕЦ РЯДОМ {conf:.0%}",
                        "confidence": round(conf, 4),
                        "bbox": box,
                    }
                )
            else:
                violations.append({"type": "suspicious_bag", "confidence": round(conf, 4), "bbox": box})

        latency_ms = round((time.perf_counter() - t0) * 1000.0, 1)
        return {
            "violations": violations,
            "safe_objects": safe_objects,
            "person_count": len(person_boxes),
            "latency_ms": latency_ms,
            # Сырые кандидаты для трекера ByteTrack / таймера выдержки бесхозной сумки
            "bags": [{"confidence": round(c, 4), "bbox": b} for c, b in bag_candidates],
            "persons": [{"confidence": round(c, 4), "bbox": b} for c, b in person_boxes],
            "profile": normalize_profile(profile),
            "components_used": [c for c in COMPONENT_ORDER if c in components],
        }

    def annotate_frame(
        self,
        frame: np.ndarray,
        analysis: dict,
        camera_title: str | None = None,
    ) -> np.ndarray:
        canvas = frame.copy()
        h, w = canvas.shape[:2]

        # Состояние трекинга бесхозных предметов: таймер выдержки до подтверждения тревоги
        dwell_threshold = float(analysis.get("bag_dwell_threshold") or settings.UNATTENDED_DWELL_SEC)
        for state in analysis.get("bag_tracks", []):
            if state.get("state") == "unattended":
                continue  # уже подтверждённая тревога рисуется ниже как violation
            x1, y1, x2, y2 = state["bbox"]
            dashed = (11, 158, 245)
            step = 14
            for x in range(x1, max(x1 + 1, x2), step * 2):
                cv2.line(canvas, (x, y1), (min(x + step, x2), y1), dashed, 2)
                cv2.line(canvas, (x, y2), (min(x + step, x2), y2), dashed, 2)
            for y in range(y1, max(y1 + 1, y2), step * 2):
                cv2.line(canvas, (x1, y), (x1, min(y + step, y2)), dashed, 2)
                cv2.line(canvas, (x2, y), (x2, min(y + step, y2)), dashed, 2)

        # Тонкие уголки и рамки в стиле профессиональных NVR-систем
        for obj in analysis.get("safe_objects", []):
            x1, y1, x2, y2 = obj["bbox"]
            color = (163, 196, 56) if obj["kind"] == "attended_bag" else (190, 175, 56)
            cv2.rectangle(canvas, (x1, y1), (x2, y2), color, 2)

        has_critical = False
        for viol in analysis.get("violations", []):
            vtype = viol["type"]
            meta = THREAT_META.get(vtype, THREAT_META["suspicious_bag"])
            if vtype == "weapon":
                has_critical = True
            x1, y1, x2, y2 = viol["bbox"]
            bgr = meta["bgr"]
            cv2.rectangle(canvas, (x1, y1), (x2, y2), bgr, 2)
            corner = max(12, min(26, (x2 - x1) // 5))
            for cx_pt, cy_pt, dx, dy in (
                (x1, y1, 1, 1),
                (x2, y1, -1, 1),
                (x1, y2, 1, -1),
                (x2, y2, -1, -1),
            ):
                cv2.line(canvas, (cx_pt, cy_pt), (cx_pt + dx * corner, cy_pt), bgr, 4)
                cv2.line(canvas, (cx_pt, cy_pt), (cx_pt, cy_pt + dy * corner), bgr, 4)

        if has_critical:
            cv2.rectangle(canvas, (3, 3), (w - 4, h - 4), (60, 60, 239), 4)

        # Чёткие кириллические бейджи и верхняя строка телеметрии через Pillow
        pil_img = Image.fromarray(cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(pil_img, "RGBA")

        if camera_title:
            ts = datetime.now().strftime("%d.%m.%Y %H:%M:%S")
            hud_text = f"● REC  {camera_title}   |   YOLOv8 ({self.active_weights_name}) · {analysis.get('latency_ms', 0):.0f} мс   |   {ts}"
            tb = draw.textbbox((0, 0), hud_text, font=FONT_HUD)
            draw.rounded_rectangle((14, 12, 30 + (tb[2] - tb[0]), 22 + (tb[3] - tb[1])), radius=6, fill=(10, 15, 28, 198))
            draw.text((22, 16), hud_text, font=FONT_HUD, fill=(226, 232, 240, 255))

        for obj in analysis.get("safe_objects", []):
            x1, y1, _, _ = obj["bbox"]
            txt = obj["label"]
            tb = draw.textbbox((0, 0), txt, font=FONT_BADGE)
            tw, th = tb[2] - tb[0], tb[3] - tb[1]
            by = max(4, y1 - th - 10)
            fill = (16, 120, 88, 215) if obj["kind"] == "attended_bag" else (15, 118, 110, 195)
            draw.rounded_rectangle((x1, by, x1 + tw + 14, by + th + 8), radius=5, fill=fill)
            draw.text((x1 + 7, by + 3), txt, font=FONT_BADGE, fill=(255, 255, 255, 255))

        for state in analysis.get("bag_tracks", []):
            if state.get("state") == "unattended":
                continue
            x1, y1, _, _ = state["bbox"]
            txt = f"ВЫДЕРЖКА {state.get('dwell_seconds', 0):.1f} / {dwell_threshold:.0f} c"
            tb = draw.textbbox((0, 0), txt, font=FONT_BADGE)
            tw, th = tb[2] - tb[0], tb[3] - tb[1]
            by = max(4, y1 - th - 10)
            draw.rounded_rectangle((x1, by, x1 + tw + 12, by + th + 8), radius=5, fill=(150, 96, 10, 220))
            draw.text((x1 + 6, by + 3), txt, font=FONT_BADGE, fill=(255, 245, 220, 255))

        for viol in analysis.get("violations", []):
            vtype = viol["type"]
            meta = THREAT_META.get(vtype, THREAT_META["suspicious_bag"])
            x1, y1, _, _ = viol["bbox"]
            txt = f"▲ {meta['ru']} · {viol['confidence']:.0%}"
            tb = draw.textbbox((0, 0), txt, font=FONT_BADGE)
            tw, th = tb[2] - tb[0], tb[3] - tb[1]
            by = max(4, y1 - th - 12)
            r, g, b = meta["rgb"]
            draw.rounded_rectangle((x1, by, x1 + tw + 16, by + th + 9), radius=5, fill=(r, g, b, 235))
            draw.text((x1 + 8, by + 4), txt, font=FONT_BADGE, fill=(255, 255, 255, 255))

        return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

    def analyze_frame(self, frame: np.ndarray, camera_title: str | None = None) -> tuple[np.ndarray, dict]:
        analysis = self.detect_frame(frame)
        annotated = self.annotate_frame(frame, analysis, camera_title=camera_title)
        return annotated, analysis


detector = ViolationDetector()
