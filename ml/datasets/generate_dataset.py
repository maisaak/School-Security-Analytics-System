from __future__ import annotations

import random
from pathlib import Path
import cv2
import numpy as np


CLASS_MAP = {
    "dog": 0,
    "weapon": 1,
    "suspicious_bag": 2,
}


def extract_foreground_rgba(img_bgr: np.ndarray, white_thresh: int = 242) -> np.ndarray:
    """Выделяет объект с белого студийного фона в RGBA с мягкой антиалиас-границей и обрезкой пустых полей."""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    # Маска переднего плана: всё, что заметно темнее чистого белого фона или имеет цветовую насыщенность
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    mask = ((gray < white_thresh) | (hsv[:, :, 1] > 22)).astype(np.uint8) * 255

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

    ys, xs = np.where(mask > 0)
    if len(xs) < 25 or len(ys) < 25:
        h, w = img_bgr.shape[:2]
        rgba = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2BGRA)
        rgba[:, :, 3] = 255
        return rgba

    pad = 4
    x1, x2 = max(0, int(xs.min()) - pad), min(img_bgr.shape[1], int(xs.max()) + pad)
    y1, y2 = max(0, int(ys.min()) - pad), min(img_bgr.shape[0], int(ys.max()) + pad)

    crop_bgr = img_bgr[y1:y2, x1:x2].copy()
    crop_mask = cv2.GaussianBlur(mask[y1:y2, x1:x2], (3, 3), 0)

    rgba = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = crop_mask
    return rgba


def paste_sprite(
    canvas: np.ndarray,
    sprite_rgba: np.ndarray,
    center_x: int,
    bottom_y: int,
    target_h: int,
    draw_shadow: bool = True,
) -> tuple[int, int, int, int] | None:
    """Реалистично накладывает RGBA-спрайт с контактной тенью на кадр CCTV и возвращает точный bbox."""
    sh, sw = sprite_rgba.shape[:2]
    if sh <= 0 or sw <= 0 or target_h < 16:
        return None

    scale = target_h / float(sh)
    nw = max(16, int(round(sw * scale)))
    nh = max(16, int(round(sh * scale)))

    resized = cv2.resize(sprite_rgba, (nw, nh), interpolation=cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR)

    x1 = center_x - nw // 2
    y1 = bottom_y - nh
    x2 = x1 + nw
    y2 = y1 + nh

    ch, cw = canvas.shape[:2]
    ix1, iy1 = max(0, x1), max(0, y1)
    ix2, iy2 = min(cw, x2), min(ch, y2)
    if ix2 - ix1 < 12 or iy2 - iy1 < 12:
        return None

    if draw_shadow:
        shadow_layer = canvas.copy()
        sx = max(0, min(cw - 1, center_x))
        sy = max(0, min(ch - 1, bottom_y - max(2, nh // 18)))
        cv2.ellipse(
            shadow_layer,
            (sx, sy),
            (max(8, int(nw * 0.42)), max(4, int(nh * 0.08))),
            0,
            0,
            360,
            (18, 20, 24),
            -1,
        )
        cv2.addWeighted(shadow_layer, 0.28, canvas, 0.72, 0, dst=canvas)

    sx1, sy1 = ix1 - x1, iy1 - y1
    sx2, sy2 = sx1 + (ix2 - ix1), sy1 + (iy2 - iy1)

    roi = canvas[iy1:iy2, ix1:ix2].astype(np.float32)
    fg = resized[sy1:sy2, sx1:sx2, :3].astype(np.float32)
    alpha = (resized[sy1:sy2, sx1:sx2, 3:4].astype(np.float32)) / 255.0

    canvas[iy1:iy2, ix1:ix2] = np.clip(fg * alpha + roi * (1.0 - alpha), 0, 255).astype(np.uint8)
    return ix1, iy1, ix2, iy2


def ensure_custom_dataset(project_root: Path, train_count: int = 36, val_count: int = 12) -> dict:
    """Генерирует размеченный YOLO-датасет для 3 классов безопасности, если базовые кадры ещё не созданы."""
    ds_root = project_root / "ml" / "datasets" / "custom"
    for split in ("train", "val"):
        (ds_root / "images" / split).mkdir(parents=True, exist_ok=True)
        (ds_root / "labels" / split).mkdir(parents=True, exist_ok=True)

    existing_train = list((ds_root / "images" / "train").glob("seed_*.jpg"))
    if len(existing_train) >= train_count:
        return get_dataset_stats(project_root)

    assets_dir = project_root / "ml" / "assets"
    scenes = [
        cv2.imread(str(p))
        for p in sorted((assets_dir / "scenes").glob("*.jpg"))
        if cv2.imread(str(p)) is not None
    ]
    if not scenes:
        fallback = np.full((540, 960, 3), 120, dtype=np.uint8)
        scenes = [fallback]

    sprites = {
        "dog": extract_foreground_rgba(cv2.imread(str(assets_dir / "sprites" / "dog_white.png"))),
        "weapon": extract_foreground_rgba(cv2.imread(str(assets_dir / "sprites" / "weapon_white.jpg"))),
        "suspicious_bag": extract_foreground_rgba(cv2.imread(str(assets_dir / "sprites" / "backpack_white.png"))),
        "person": extract_foreground_rgba(cv2.imread(str(assets_dir / "sprites" / "student_white.png"))),
    }

    rng = random.Random(42)

    for split, count in (("train", train_count), ("val", val_count)):
        for idx in range(count):
            bg = scenes[idx % len(scenes)].copy()
            bg = cv2.resize(bg, (960, 540))

            # Небольшая аугментация освещённости камеры
            gain = rng.uniform(0.86, 1.14)
            bias = rng.uniform(-12, 12)
            bg = np.clip(bg.astype(np.float32) * gain + bias, 0, 255).astype(np.uint8)

            labels: list[str] = []

            # Иногда добавляем проходящего человека как hard-negative фон (без метки нарушения)
            if rng.random() < 0.45:
                p_sprite = sprites["person"]
                if rng.random() < 0.5:
                    p_sprite = cv2.flip(p_sprite, 1)
                paste_sprite(
                    bg,
                    p_sprite,
                    center_x=rng.randint(150, 810),
                    bottom_y=rng.randint(360, 515),
                    target_h=rng.randint(210, 310),
                )

            # Гарантированно размещаем 1-2 целевых объекта из классов dog / weapon / suspicious_bag
            target_cls_names = [list(CLASS_MAP.keys())[idx % 3]]
            if rng.random() < 0.4:
                target_cls_names.append(rng.choice(list(CLASS_MAP.keys())))

            for cls_name in target_cls_names:
                sp = sprites[cls_name].copy()
                if rng.random() < 0.5:
                    sp = cv2.flip(sp, 1)

                if cls_name == "dog":
                    th = rng.randint(95, 165)
                elif cls_name == "suspicious_bag":
                    th = rng.randint(90, 155)
                else:
                    th = rng.randint(68, 125)

                bbox = paste_sprite(
                    bg,
                    sp,
                    center_x=rng.randint(140, 820),
                    bottom_y=rng.randint(290, 510),
                    target_h=th,
                    draw_shadow=(cls_name != "weapon"),
                )
                if bbox:
                    x1, y1, x2, y2 = bbox
                    cx = ((x1 + x2) / 2.0) / 960.0
                    cy = ((y1 + y2) / 2.0) / 540.0
                    bw = (x2 - x1) / 960.0
                    bh = (y2 - y1) / 540.0
                    labels.append(f"{CLASS_MAP[cls_name]} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")

            stem = f"seed_{split}_{idx:03d}"
            cv2.imwrite(str(ds_root / "images" / split / f"{stem}.jpg"), bg, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
            (ds_root / "labels" / split / f"{stem}.txt").write_text("\n".join(labels), encoding="utf-8")

    return get_dataset_stats(project_root)


def get_dataset_stats(project_root: Path) -> dict:
    ds_root = project_root / "ml" / "datasets" / "custom"
    class_counts = {"dog": 0, "weapon": 0, "suspicious_bag": 0}
    inv_map = {v: k for k, v in CLASS_MAP.items()}
    train_images = 0
    val_images = 0
    user_uploaded = 0

    for split in ("train", "val"):
        imgs = list((ds_root / "images" / split).glob("*.*"))
        if split == "train":
            train_images = len(imgs)
            user_uploaded += sum(1 for p in imgs if p.name.startswith("user_"))
        else:
            val_images = len(imgs)

        for lbl_file in (ds_root / "labels" / split).glob("*.txt"):
            for line in lbl_file.read_text(encoding="utf-8").splitlines():
                parts = line.strip().split()
                if parts and parts[0].isdigit():
                    cname = inv_map.get(int(parts[0]))
                    if cname:
                        class_counts[cname] += 1

    return {
        "train_images": train_images,
        "val_images": val_images,
        "total_images": train_images + val_images,
        "user_uploaded_images": user_uploaded,
        "class_annotations": class_counts,
    }


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    stats = ensure_custom_dataset(root)
    print("Dataset ready:", stats)
