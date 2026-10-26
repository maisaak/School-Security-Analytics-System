import io
import json

from app.core.config import settings
from app.db.models import RetrainJob
from app.db.session import SessionLocal
from app.services import tasks


def test_successful_training_is_candidate_not_active(client, monkeypatch):
    with SessionLocal() as db:
        row = RetrainJob(status="queued", epochs=2, dataset_yaml="ml/datasets/school_security.yaml")
        db.add(row)
        db.commit()
        job_id = row.id
    commands = []

    class Process:
        def __init__(self, command, **kwargs):
            commands.append(command)
            self.stdout = io.StringIO("PROGRESS_JSON:" + json.dumps({"epoch": 2, "epochs": 2, "metrics": {"metrics/mAP50(B)": .5}}) + "\nRESULT_JSON:" + json.dumps({"saved_weights": "candidate.pt", "metrics": {"metrics/mAP50(B)": .5}}) + "\n")
        def wait(self, **kwargs):
            return 0
        def poll(self):
            return 0
        def kill(self):
            pass

    monkeypatch.setattr(tasks.subprocess, "Popen", Process)
    tasks.execute_retrain_job(job_id, 2, "ml/datasets/school_security.yaml")
    jobs = client.get("/api/models/jobs").json()
    assert jobs[0]["status"] == "ready", jobs[0]["details"]
    assert jobs[0]["current_epoch"] == 2
    assert jobs[0]["metrics"]["metrics/mAP50(B)"] == .5
    assert "--output" in commands[0]
    assert "candidates" in commands[0][commands[0].index("--output") + 1]
    tasks.execute_retrain_job(job_id, 2, "ml/datasets/school_security.yaml")
    assert len(commands) == 1  # Duplicate delivery cannot rerun a completed job.


def test_process_failure_recorded_without_metrics(client, monkeypatch):
    with SessionLocal() as db:
        row = RetrainJob(status="queued", epochs=1)
        db.add(row)
        db.commit()
        job_id = row.id

    def fail(*args, **kwargs):
        raise OSError("Test process failure")

    monkeypatch.setattr(tasks.subprocess, "Popen", fail)
    tasks.execute_retrain_job(job_id, 1, "ml/datasets/school_security.yaml")
    result = client.get("/api/models/jobs").json()[0]
    assert result["status"] == "failed"
    assert result["metrics"] == {}
