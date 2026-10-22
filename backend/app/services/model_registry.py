from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import PROJECT_ROOT, settings
from app.db.models import ModelVersion

logger = logging.getLogger("school_security.registry")


def rel_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def abs_path(rel: str) -> Path:
    p = Path(rel)
    return p if p.is_absolute() else (PROJECT_ROOT / p).resolve()


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _clean_metrics(metrics: dict | None) -> dict[str, float]:
    cleaned: dict[str, float] = {}
    for key, value in (metrics or {}).items():
        try:
            cleaned[str(key)] = round(float(value), 4)
        except (TypeError, ValueError):
            continue
    return cleaned


def map50_from_metrics(metrics: dict) -> float | None:
    for key in ("metrics/mAP50(B)", "metrics/mAP50", "map50", "mAP50"):
        if key in metrics and metrics[key] is not None:
            try:
                return round(float(metrics[key]), 4)
            except (TypeError, ValueError):
                return None
    return None


def map50_95_from_metrics(metrics: dict) -> float | None:
    for key in ("metrics/mAP50-95(B)", "metrics/mAP50-95", "map50_95"):
        if key in metrics and metrics[key] is not None:
            try:
                return round(float(metrics[key]), 4)
            except (TypeError, ValueError):
                return None
    return None


def current_production(db: Session) -> ModelVersion | None:
    return (
        db.query(ModelVersion)
        .filter(ModelVersion.status == "production")
        .order_by(ModelVersion.activated_at.desc().nullslast(), ModelVersion.id.desc())
        .first()
    )


def baseline_map50(db: Session) -> float | None:
    prod = current_production(db)
    if prod and prod.map50 is not None:
        return prod.map50
    return None


def register_version(
    db: Session,
    *,
    weights_path: Path,
    metrics: dict,
    label: str | None = None,
    job_id: int | None = None,
    source: str = "retrain",
    created_by: str = "system",
    status: str = "candidate",
    validation_passed: bool | None = None,
    validation_notes: str = "",
    baseline: float | None = None,
) -> ModelVersion:
    """Кладёт копию весов в реестр версий и регистрирует её в БД (без активации)."""
    weights_path = weights_path.resolve()
    if not weights_path.is_file():
        raise FileNotFoundError(f"Файл весов не найден: {weights_path}")

    settings.MODEL_VERSIONS_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    target = settings.MODEL_VERSIONS_ROOT / f"{label or f'v{stamp}'}_{source}.pt"
    if target.resolve() != weights_path:
        counter = 1
        base_target = target
        while target.exists():
            target = base_target.with_name(f"{base_target.stem}_{counter}{base_target.suffix}")
            counter += 1
        shutil.copy2(weights_path, target)

    cleaned = _clean_metrics(metrics)
    version = ModelVersion(
        label=label or f"v{stamp}-{source}",
        weights_path=rel_path(target),
        metrics_json=json.dumps(cleaned, ensure_ascii=False),
        map50=map50_from_metrics(cleaned),
        map50_95=map50_95_from_metrics(cleaned),
        baseline_map50=baseline,
        status=status,
        validation_passed=validation_passed,
        validation_notes=validation_notes,
        job_id=job_id,
        source=source,
        size_bytes=target.stat().st_size,
        sha256=sha256_of(target),
        created_by=created_by,
        activated_at=datetime.now(timezone.utc) if status == "production" else None,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return version


def ensure_baseline_version(db: Session, metrics: dict | None = None) -> ModelVersion | None:
    """Гарантирует, что текущие боевые веса присутствуют в реестре как production-версия."""
    if db.query(ModelVersion).count() > 0:
        return current_production(db)

    canonical = Path(settings.YOLO_CUSTOM_MODEL_PATH)
    if not canonical.is_file():
        return None
    try:
        version = register_version(
            db,
            weights_path=canonical,
            metrics=metrics or {},
            label="baseline-v1",
            source="baseline",
            created_by="system",
            status="production",
            validation_passed=True,
            validation_notes="Базовая версия весов, зафиксированная при инициализации реестра",
            baseline=None,
        )
        return version
    except Exception:
        logger.exception("Не удалось зарегистрировать baseline-версию весов")
        db.rollback()
        return None


def evaluate_validation_gate(
    db: Session,
    candidate: ModelVersion,
    *,
    tolerance: float | None = None,
    min_absolute: float | None = None,
) -> tuple[bool, str]:
    """
    Validation Gate: новая версия весов допускается в production только если
    её mAP@50 не упал относительно текущей боевой версии (с допуском tolerance).
    """
    tol = settings.MAP50_ROLLBACK_TOLERANCE if tolerance is None else tolerance
    floor = settings.MAP50_MIN_ABSOLUTE if min_absolute is None else min_absolute

    if candidate.map50 is None:
        return False, "В метриках обучения отсутствует mAP@50 — версия не может быть проверена автоматически"
    if candidate.map50 < floor:
        return False, (
            f"mAP@50 = {candidate.map50:.1%} ниже минимального порога качества {floor:.1%}"
        )

    baseline = baseline_map50(db)
    if baseline is None:
        return True, (
            f"mAP@50 = {candidate.map50:.1%}. Базовая версия отсутствует — кандидат принят как первая боевая"
        )

    delta = candidate.map50 - baseline
    if delta < -tol:
        return False, (
            f"mAP@50 упал с {baseline:.1%} до {candidate.map50:.1%} "
            f"(Δ {delta * 100:+.2f} п.п., допустимо не ниже -{tol * 100:.2f} п.п.) — откат к прежним весам"
        )
    return True, (
        f"mAP@50 = {candidate.map50:.1%} (базовая {baseline:.1%}, Δ {delta * 100:+.2f} п.п.) — "
        "порог Validation Gate пройден"
    )


def activate_version(
    db: Session,
    version: ModelVersion,
    *,
    reason: str = "",
    detector_reload: bool = True,
) -> ModelVersion:
    """
    Делает версию боевой: архивирует предыдущую production-версию, атомарно
    подменяет канонический файл весов и перезагружает детектор без остановки камер.
    """
    weights = abs_path(version.weights_path)
    if not weights.is_file():
        raise FileNotFoundError(f"Файл весов версии '{version.label}' отсутствует в реестре")

    current = current_production(db)
    if current is not None and current.id != version.id:
        current.status = "archived"
        current.validation_notes = (current.validation_notes or "").strip() or "Вытеснена новой production-версией"

    canonical = Path(settings.YOLO_CUSTOM_MODEL_PATH)
    canonical.parent.mkdir(parents=True, exist_ok=True)
    tmp = canonical.with_suffix(".pt.tmp")
    shutil.copy2(weights, tmp)
    os.replace(tmp, canonical)

    version.status = "production"
    version.activated_at = datetime.now(timezone.utc)
    if reason:
        version.validation_notes = (version.validation_notes or "").strip()
        version.validation_notes = (
            f"{version.validation_notes} · {reason}" if version.validation_notes else reason
        )
    db.commit()
    db.refresh(version)

    if detector_reload:
        try:
            from app.models.detector import detector

            detector.reload_custom_weights(canonical)
        except Exception:
            logger.exception("Не удалось перезагрузить детектор на версию %s", version.label)

    return version


def process_retrain_result(
    db: Session,
    *,
    job_id: int,
    staged_weights: Path,
    metrics: dict,
    created_by: str = "system",
) -> tuple[ModelVersion, bool, str]:
    """
    Полный цикл Validation Gate после дообучения:
    регистрация кандидата -> проверка mAP@50 -> promotion либо отказ с сохранением прежних весов.
    """
    baseline = baseline_map50(db)
    candidate = register_version(
        db,
        weights_path=staged_weights,
        metrics=metrics,
        label=f"job{job_id}",
        job_id=job_id,
        source="retrain",
        created_by=created_by,
        status="candidate",
        baseline=baseline,
    )
    passed, notes = evaluate_validation_gate(db, candidate)
    candidate.validation_passed = passed
    candidate.validation_notes = notes

    if passed:
        activate_version(db, candidate, reason="Автоматический promotion после Validation Gate")
    else:
        candidate.status = "rejected"
        db.commit()
        db.refresh(candidate)

    return candidate, passed, notes
