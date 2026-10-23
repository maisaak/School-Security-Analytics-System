from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from celery import Celery

from app.core.config import PROJECT_ROOT, settings
from app.db.models import RetrainJob
from app.db.session import SessionLocal
from app.services.audit import record_audit
from app.services.model_registry import map50_from_metrics, process_retrain_result

celery_app = Celery(
    "school_security",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
)


def execute_retrain_job(job_id: int, epochs: int, dataset_yaml: str) -> None:
    """
    Запускает дообучение YOLOv8 в отдельном процессе, пишет прогресс в БД и по завершении
    прогоняет Validation Gate: в production попадают только веса с mAP@50 не ниже базового.
    """
    db = SessionLocal()
    staged_weights = settings.MODEL_VERSIONS_ROOT / f"staging_job{job_id}.pt"
    try:
        job = db.query(RetrainJob).filter(RetrainJob.id == job_id).first()
        if not job:
            return
        job.status = "running"
        job.current_epoch = 0
        job.details = "Инициализация процесса обучения Ultralytics YOLOv8..."
        db.commit()

        env = os.environ.copy()
        env["PYTHONPATH"] = str(PROJECT_ROOT)

        cmd = [
            sys.executable,
            str(PROJECT_ROOT / "ml" / "train.py"),
            "--epochs",
            str(epochs),
            "--data",
            str(dataset_yaml),
            "--base",
            str(settings.YOLO_COCO_MODEL_PATH),
            "--output",
            str(staged_weights),
            "--json-progress",
        ]

        proc = subprocess.Popen(
            cmd,
            cwd=str(PROJECT_ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        final_summary: dict | None = None
        tail_lines: list[str] = []

        assert proc.stdout is not None
        for raw_line in proc.stdout:
            line = raw_line.strip()
            if not line:
                continue
            tail_lines.append(line)
            if len(tail_lines) > 25:
                tail_lines.pop(0)

            if line.startswith("PROGRESS_JSON:"):
                payload = json.loads(line.removeprefix("PROGRESS_JSON:"))
                s_db = SessionLocal()
                try:
                    row = s_db.query(RetrainJob).filter(RetrainJob.id == job_id).first()
                    if row:
                        row.current_epoch = int(payload["epoch"])
                        row.metrics_json = json.dumps(payload["metrics"])
                        map50 = payload["metrics"].get("metrics/mAP50(B)")
                        suffix = f" · mAP@50: {map50:.1%}" if isinstance(map50, float) else ""
                        row.details = f"Эпоха {payload['epoch']}/{payload['epochs']} завершена{suffix}"
                        s_db.commit()
                finally:
                    s_db.close()
            elif line.startswith("RESULT_JSON:"):
                final_summary = json.loads(line.removeprefix("RESULT_JSON:"))

        ret = proc.wait()
        if ret != 0 or final_summary is None:
            raise RuntimeError(" | ".join(tail_lines[-5:]))

        saved = Path(final_summary.get("saved_weights") or staged_weights)
        if not saved.is_file():
            raise RuntimeError("Процесс обучения не создал файл весов")

        job = db.query(RetrainJob).filter(RetrainJob.id == job_id).first()
        baseline = job.baseline_map50 if job else None

        version, passed, notes = process_retrain_result(
            db,
            job_id=job_id,
            staged_weights=saved,
            metrics=final_summary.get("metrics", {}),
            created_by=(job.requested_by if job else None) or "system",
        )

        final_map50 = map50_from_metrics(version.metrics_json and json.loads(version.metrics_json) or {})

        job = db.query(RetrainJob).filter(RetrainJob.id == job_id).first()
        if job:
            job.version_id = version.id
            job.final_map50 = final_map50
            job.baseline_map50 = version.baseline_map50 if version.baseline_map50 is not None else baseline
            job.validation_passed = passed
            job.current_epoch = epochs
            job.metrics_json = json.dumps(json.loads(version.metrics_json or "{}"))
            job.completed_at = datetime.now(timezone.utc)
            if passed:
                job.status = "completed"
                job.details = f"Версия {version.label} прошла Validation Gate и активна · {notes}"
            else:
                job.status = "rejected"
                job.details = f"Версия {version.label} отклонена Validation Gate · {notes}"
            db.commit()

        record_audit(
            db,
            action="model.version.promoted" if passed else "model.version.rejected",
            actor_username="system",
            actor_role="system",
            entity_type="model_version",
            entity_id=version.id,
            outcome="success",
            detail={
                "job_id": job_id,
                "version": version.label,
                "map50": final_map50,
                "baseline_map50": version.baseline_map50,
                "validation_notes": notes,
                "weights_path": version.weights_path,
            },
        )
    except Exception as exc:
        db.rollback()
        job = db.query(RetrainJob).filter(RetrainJob.id == job_id).first()
        if job:
            job.status = "failed"
            job.details = f"Ошибка обучения: {exc}"
            job.validation_passed = False
            job.completed_at = datetime.now(timezone.utc)
            db.commit()
        record_audit(
            db,
            action="model.retrain.failed",
            actor_username="system",
            actor_role="system",
            entity_type="retrain_job",
            entity_id=job_id,
            outcome="failure",
            detail={"error": str(exc)[:1500]},
        )
    finally:
        try:
            if staged_weights.is_file():
                staged_weights.unlink(missing_ok=True)
        except OSError:
            pass
        db.close()


@celery_app.task(name="models.retrain")
def retrain_model_task(job_id: int, epochs: int, dataset_yaml: str) -> None:
    execute_retrain_job(job_id, epochs, dataset_yaml)
