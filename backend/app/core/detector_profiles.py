from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DetectorProfile:
    """Набор моделей ансамбля, который применяется к кадру камеры."""

    key: str
    label: str
    description: str
    components: tuple[str, ...]
    accent: str = "emerald"


# Компоненты ансамбля. Порядок важен для UI.
COMPONENT_ORDER: tuple[str, ...] = ("coco", "weapon", "custom")

COMPONENT_LABELS: dict[str, str] = {
    "coco": "YOLOv8n · COCO",
    "weapon": "Детектор оружия",
    "custom": "Школьная модель",
}

DETECTOR_PROFILES: dict[str, DetectorProfile] = {
    "ensemble": DetectorProfile(
        key="ensemble",
        label="Ансамбль (COCO + оружие + школа)",
        description=(
            "Все три модели: люди, рюкзаки, собаки, оружие и школьные классы. "
            "Максимальная полнота, наибольшая нагрузка на CPU."
        ),
        components=("coco", "weapon", "custom"),
        accent="emerald",
    ),
    "custom": DetectorProfile(
        key="custom",
        label="Школьная модель",
        description=(
            "Только дообученные веса школы (dog, weapon, suspicious_bag). "
            "Самая быстрая схема; детектор людей из COCO не используется."
        ),
        components=("custom",),
        accent="indigo",
    ),
    "custom_weapon": DetectorProfile(
        key="custom_weapon",
        label="Школа + оружие",
        description=(
            "Школьные классы плюс специализированный детектор оружия. "
            "Оптимально для КПП, где важнее всего оружие."
        ),
        components=("custom", "weapon"),
        accent="amber",
    ),
    "coco": DetectorProfile(
        key="coco",
        label="COCO (люди и обстановка)",
        description=(
            "Только универсальная YOLOv8n: person, backpack, handbag, suitcase, dog, knife. "
            "Полезно, когда дообученные веса недоступны."
        ),
        components=("coco",),
        accent="sky",
    ),
    "weapon": DetectorProfile(
        key="weapon",
        label="Только оружие",
        description=(
            "Специализированный детектор оружия без остальных классов. "
            "Минимальная нагрузка на КПП и рамке металлодетектора."
        ),
        components=("weapon",),
        accent="red",
    ),
}

DEFAULT_PROFILE = "ensemble"


def normalize_profile(value: str | None) -> str:
    key = str(value or "").strip().lower()
    return key if key in DETECTOR_PROFILES else DEFAULT_PROFILE


def profile_components(value: str | None) -> tuple[str, ...]:
    return DETECTOR_PROFILES[normalize_profile(value)].components


def profile_catalog(camera_counts: dict[str, int] | None = None) -> list[dict]:
    counts = camera_counts or {}
    return [
        {
            "key": profile.key,
            "label": profile.label,
            "description": profile.description,
            "components": list(profile.components),
            "accent": profile.accent,
            "cameras": int(counts.get(profile.key, 0)),
        }
        for profile in DETECTOR_PROFILES.values()
    ]
