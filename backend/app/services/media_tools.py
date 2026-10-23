from __future__ import annotations

import io
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app.core.config import PROJECT_ROOT
from app.models.detector import detector

FONT_CANDIDATES = [
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
    PROJECT_ROOT / "frontend" / "public" / "fonts" / "DejaVuSans.ttf",
]


def _load_font(size: int) -> ImageFont.ImageFont:
    for candidate in FONT_CANDIDATES:
        if candidate.is_file():
            try:
                return ImageFont.truetype(str(candidate), size)
            except OSError:
                continue
    return ImageFont.load_default()


def watermark_image(image_bgr: np.ndarray, text: str) -> np.ndarray:
    """Диагональный водяной знак с ФИО/логином сотрудника и временем выгрузки."""
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    pil = Image.fromarray(rgb).convert("RGBA")
    overlay = Image.new("RGBA", pil.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = _load_font(max(14, pil.width // 34))
    step_x = max(260, pil.width // 2)
    step_y = max(90, pil.height // 4)
    for y in range(-pil.height, pil.height * 2, step_y):
        for x in range(-pil.width, pil.width * 2, step_x):
            draw.text((x, y), text, font=font, fill=(255, 255, 255, 70))
    rotated = overlay.rotate(18, expand=False)
    merged = Image.alpha_composite(pil, rotated).convert("RGB")
    return cv2.cvtColor(np.array(merged), cv2.COLOR_RGB2BGR)


def blur_person_heads(image_bgr: np.ndarray) -> np.ndarray:
    """
    Обезличивание: находит людей COCO-детектором и размывает голову (верхнюю
    треть bbox человека). Сами лица не распознаются и не сохраняются — это
    требование 152-ФЗ при выгрузке кадров с участием детей.
    """
    try:
        analysis = detector.detect_frame(image_bgr, profile="coco")
    except Exception:
        return image_bgr
    persons = analysis.get("persons") or []
    if not persons:
        return image_bgr
    height, width = image_bgr.shape[:2]
    result = image_bgr.copy()
    for person in persons:
        bbox = person.get("bbox") or []
        if len(bbox) < 4:
            continue
        x1, y1, x2, y2 = [int(v) for v in bbox[:4]]
        pw, ph = max(1, x2 - x1), max(1, y2 - y1)
        hx1 = max(0, x1 + int(pw * 0.18))
        hx2 = min(width, x2 - int(pw * 0.18))
        hy1 = max(0, y1)
        hy2 = min(height, y1 + int(ph * 0.34))
        if hx2 - hx1 < 8 or hy2 - hy1 < 8:
            continue
        region = result[hy1:hy2, hx1:hx2]
        ksize = max(9, ((hx2 - hx1) // 3) | 1)
        result[hy1:hy2, hx1:hx2] = cv2.GaussianBlur(region, (ksize, ksize), 0)
    return result


def annotate_violation(image_bgr: np.ndarray, bbox: list[float] | None, label: str) -> np.ndarray:
    result = image_bgr.copy()
    if bbox and len(bbox) >= 4:
        x1, y1, x2, y2 = [int(v) for v in bbox[:4]]
        cv2.rectangle(result, (x1, y1), (x2, y2), (0, 0, 255), 2)
        cv2.putText(result, label, (x1, max(18, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
    return result


def processed_snapshot(
    path: Path,
    *,
    watermark: str | None = None,
    blur_faces: bool = False,
    annotate: tuple[list[float] | None, str] | None = None,
) -> bytes:
    """Готовит защищённую копию снимка инцидента для скачивания/отчёта."""
    image = cv2.imread(str(path))
    if image is None:
        raise FileNotFoundError(str(path))
    if annotate:
        image = annotate_violation(image, annotate[0], annotate[1])
    if blur_faces:
        image = blur_person_heads(image)
    if watermark:
        image = watermark_image(image, watermark)
    ok, buffer = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    if not ok:
        raise RuntimeError("Не удалось закодировать изображение")
    return buffer.tobytes()


def thumbnail_bytes(path: Path, width: int = 320) -> bytes | None:
    try:
        image = Image.open(path).convert("RGB")
    except Exception:
        return None
    ratio = width / max(1, image.width)
    image = image.resize((width, max(1, int(image.height * ratio))), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=80)
    return buffer.getvalue()
