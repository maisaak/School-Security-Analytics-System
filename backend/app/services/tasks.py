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
from app.models.detector import detector

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
    db = SessionLocal()
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

        detector.reload_custom_weights(final_summary["saved_weights"])

        job = db.query(RetrainJob).filter(RetrainJob.id == job_id).first()
        if job:
            job.status = "completed"
            job.current_epoch = epochs
            job.metrics_json = json.dumps(final_summary["metrics"])
            map50 = final_summary["metrics"].get("metrics/mAP50(B)", 0.0)
            job.details = f"Веса успешно обновлены ({Path(final_summary['saved_weights']).name}) · mAP@50 = {map50:.1%}"
            job.completed_at = datetime.now(timezone.utc)
            db.commit()
    except Exception as exc:
        db.rollback()
        job = db.query(RetrainJob).filter(RetrainJob.id == job_id).first()
        if job:
            job.status = "failed"
            job.details = f"Ошибка обучения: {exc}"
            job.completed_at = datetime.now(timezone.utc)
            db.commit()
    finally:
        db.close()


@celery_app.task(name="models.retrain")
def retrain_model_task(job_id: int, epochs: int, dataset_yaml: str) -> None:
    execute_retrain_job(job_id, epochs, dataset_yaml)
