"""Validate human-labelled YOLO datasets. Synthetic demo data is never production training data."""
from __future__ import annotations

import hashlib
import math
from pathlib import Path

import yaml
from PIL import Image, UnidentifiedImageError

EXPECTED_NAMES = {0: "dog", 1: "weapon", 2: "suspicious_bag"}


def validate_dataset(yaml_path: str | Path) -> dict:
    yaml_path = Path(yaml_path).resolve()
    config = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise ValueError("Некорректный YAML датасета")
    names = config.get("names", {})
    if isinstance(names, list):
        names = dict(enumerate(names))
    if names != EXPECTED_NAMES:
        raise ValueError("Ожидаемые классы: 0 dog, 1 weapon, 2 suspicious_bag")
    root = Path(config.get("path", "custom"))
    if not root.is_absolute():
        root = (yaml_path.parent / root).resolve()
    allowed = yaml_path.parent.resolve()
    if not root.is_relative_to(allowed):
        raise ValueError("Корень датасета должен находиться внутри каталога YAML")
    fingerprints: dict[str, set[str]] = {}
    counts = {}
    for split in ("train", "val"):
        image_dir = (root / config.get(split, f"images/{split}")).resolve()
        if not image_dir.is_relative_to(root) or "images" not in image_dir.parts:
            raise ValueError("Split должен указывать на images/train или images/val внутри датасета")
        images = sorted(p for p in image_dir.glob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
        if len(images) < (6 if split == "train" else 3):
            raise ValueError("Нужны минимум 6 размеченных train и 3 независимых val изображения; это лишь технический минимум, не гарантия качества")
        classes: set[int] = set()
        fingerprints[split] = set()
        for image in images:
            if image.name.startswith("seed_"):
                raise ValueError("Синтетические seed_* изображения запрещены в рабочем обучении. Используйте отдельный датасет.")
            parts = list(image.relative_to(root).parts)
            parts[parts.index("images")] = "labels"
            label = root.joinpath(*parts).with_suffix(".txt")
            if not label.is_file():
                raise ValueError(f"Нет разметки для {image.name}")
            try:
                with Image.open(image) as opened:
                    pixels = opened.convert("RGB")
                    digest = hashlib.sha256(str(pixels.size).encode() + pixels.tobytes()).hexdigest()
            except (OSError, ValueError, UnidentifiedImageError) as exc:
                raise ValueError(f"Не читается изображение {image.name}") from exc
            fingerprints[split].add(digest)
            for line in label.read_text(encoding="utf-8").splitlines():
                tokens = line.split()
                if len(tokens) != 5:
                    raise ValueError(f"Некорректная YOLO-разметка: {label.name}")
                try:
                    cls = int(tokens[0])
                    cx, cy, w, h = map(float, tokens[1:])
                except ValueError as exc:
                    raise ValueError(f"Некорректные значения: {label.name}") from exc
                if cls not in EXPECTED_NAMES or not all(math.isfinite(v) for v in (cx, cy, w, h)) or not (0 < w <= 1 and 0 < h <= 1 and w / 2 - 1e-5 <= cx <= 1 - w / 2 + 1e-5 and h / 2 - 1e-5 <= cy <= 1 - h / 2 + 1e-5):
                    raise ValueError(f"Рамка вне изображения или неверный класс: {label.name}")
                classes.add(cls)
        if classes != set(EXPECTED_NAMES):
            raise ValueError(f"В {split} должны быть размечены все три класса")
        counts[split] = len(images)
    if fingerprints["train"] & fingerprints["val"]:
        raise ValueError("Одни и те же изображения обнаружены в train и val")
    return {"root": str(root), "config": config, "counts": counts}
