from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from celery import Celery

from app.core.config import PROJECT_ROOT, settings
from app.db.models import AppSetting, RetrainJob
from app.db.session import SessionLocal

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
    proc = None
    timer = None
    try:
        # Atomic claim also prevents redelivery from starting the same training twice.
        claimed = db.query(RetrainJob).filter(RetrainJob.id == job_id, RetrainJob.status == "queued").update({"status": "running"})
        db.commit()
        if not claimed:
            return
        job = db.get(RetrainJob, job_id)
        base_setting = db.get(AppSetting, "base_model")
        base_path = PROJECT_ROOT / "ml" / "models" / base_setting.value if base_setting else settings.YOLO_COCO_MODEL_PATH
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
            str(base_path),
            "--output",
            str(PROJECT_ROOT / "ml" / "models" / "candidates" / f"job_{job_id}.pt"),
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
        timer = threading.Timer(settings.TRAINING_TIMEOUT_SEC, proc.kill)
        timer.daemon = True
        timer.start()

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

        db.expire_all()
        job = db.query(RetrainJob).filter(RetrainJob.id == job_id).first()
        if job:
            job.status = "ready"
            job.current_epoch = epochs
            job.metrics_json = json.dumps(final_summary["metrics"])
            map50 = final_summary["metrics"].get("metrics/mAP50(B)", 0.0)
            job.details = f"Кандидат готов, но НЕ активирован · val mAP@50 = {map50:.1%}. Проверьте на независимом видео перед применением."
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
        if timer:
            timer.cancel()
        if proc and proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)
        db.close()


@celery_app.task(name="models.retrain")
def retrain_model_task(job_id: int, epochs: int, dataset_yaml: str) -> None:
    execute_retrain_job(job_id, epochs, dataset_yaml)
