from __future__ import annotations

import hashlib
import json
import shutil

from app.core.config import settings
from app.db.models import ModelVersion
from app.db.session import SessionLocal
from app.services.model_registry import (
    activate_version,
    current_production,
    evaluate_validation_gate,
    process_retrain_result,
    register_version,
)


def _sha256(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _copy_weights(tmp_path, name: str):
    target = tmp_path / name
    shutil.copy2(settings.YOLO_CUSTOM_MODEL_PATH, target)
    return target


def test_baseline_version_is_registered(client, admin_headers):
    response = client.get("/api/models/versions", headers=admin_headers)
    assert response.status_code == 200
    versions = response.json()
    assert versions, "Реестр версий должен содержать хотя бы baseline"
    production = [v for v in versions if v["status"] == "production"]
    assert len(production) == 1
    assert production[0]["is_current"] is True
    assert production[0]["map50"] is not None
    assert production[0]["sha256"]
    assert production[0]["size_bytes"] > 0


def test_validation_gate_accepts_and_rejects(tmp_path):
    db = SessionLocal()
    try:
        baseline = current_production(db)
        assert baseline is not None and baseline.map50 is not None

        good = register_version(
            db,
            weights_path=_copy_weights(tmp_path, "good.pt"),
            metrics={"metrics/mAP50(B)": baseline.map50 + 0.01, "metrics/mAP50-95(B)": 0.82},
            label="gate-good",
            source="retrain",
            baseline=baseline.map50,
        )
        passed, notes = evaluate_validation_gate(db, good)
        assert passed is True, notes
        assert "пройден" in notes

        bad = register_version(
            db,
            weights_path=_copy_weights(tmp_path, "bad.pt"),
            metrics={"metrics/mAP50(B)": max(0.0, baseline.map50 - 0.2)},
            label="gate-bad",
            source="retrain",
            baseline=baseline.map50,
        )
        passed, notes = evaluate_validation_gate(db, bad)
        assert passed is False
        assert "упал" in notes

        no_metrics = register_version(
            db,
            weights_path=_copy_weights(tmp_path, "nometrics.pt"),
            metrics={},
            label="gate-nometrics",
            source="retrain",
        )
        passed, notes = evaluate_validation_gate(db, no_metrics)
        assert passed is False
        assert "mAP@50" in notes
    finally:
        db.close()


def test_rejected_retrain_keeps_previous_production_weights(tmp_path):
    canonical = settings.YOLO_CUSTOM_MODEL_PATH
    sha_before = _sha256(canonical)

    db = SessionLocal()
    try:
        production_before = current_production(db)
        assert production_before is not None
        staged = _copy_weights(tmp_path, "staged_regression.pt")

        candidate, passed, notes = process_retrain_result(
            db,
            job_id=999_001,
            staged_weights=staged,
            metrics={"metrics/mAP50(B)": 0.41, "metrics/mAP50-95(B)": 0.21},
        )

        assert passed is False
        assert candidate.status == "rejected"
        assert candidate.validation_passed is False
        assert "упал" in notes

        production_after = current_production(db)
        assert production_after is not None
        assert production_after.id == production_before.id, "Боевая версия не должна меняться при провале gate"
        assert _sha256(canonical) == sha_before, "Файл боевых весов не должен меняться без прохождения gate"
    finally:
        db.close()


def test_successful_retrain_promotes_candidate(tmp_path):
    db = SessionLocal()
    try:
        baseline = current_production(db)
        assert baseline is not None and baseline.map50 is not None
        staged = _copy_weights(tmp_path, "staged_improved.pt")

        candidate, passed, notes = process_retrain_result(
            db,
            job_id=999_002,
            staged_weights=staged,
            metrics={"metrics/mAP50(B)": min(0.999, baseline.map50 + 0.005), "metrics/mAP50-95(B)": 0.83},
        )
        assert passed is True, notes
        assert candidate.status == "production"

        db.expire_all()
        baseline_after = db.query(ModelVersion).filter(ModelVersion.id == baseline.id).first()
        assert baseline_after.status == "archived"
        assert current_production(db).id == candidate.id
    finally:
        db.close()


def test_admin_can_rollback_to_previous_version(client, admin_headers):
    versions = client.get("/api/models/versions", headers=admin_headers).json()
    baseline = next(v for v in versions if v["source"] == "baseline")

    response = client.post(
        f"/api/models/versions/{baseline['id']}/rollback",
        headers=admin_headers,
        json={"reason": "Автотест: возврат к эталонным весам", "force": False},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "production"
    assert payload["is_current"] is True

    versions_after = client.get("/api/models/versions", headers=admin_headers).json()
    production = [v for v in versions_after if v["status"] == "production"]
    assert len(production) == 1
    assert production[0]["id"] == baseline["id"]

    audit = client.get("/api/audit", headers=admin_headers, params={"action": "model.rollback"})
    assert audit.status_code == 200
    assert audit.json()["total"] >= 1
    detail = json.loads(audit.json()["items"][0]["detail"])
    assert detail["restored_version"] == baseline["label"]
    assert "Автотест" in detail["reason"]


def test_rollback_forbidden_for_director(client, director_headers):
    versions = client.get("/api/models/versions", headers=director_headers).json()
    target = versions[-1]
    response = client.post(
        f"/api/models/versions/{target['id']}/rollback",
        headers=director_headers,
        json={"reason": "Попытка директора"},
    )
    assert response.status_code == 403


def test_rollback_requires_force_for_rejected_version(client, admin_headers):
    versions = client.get("/api/models/versions", headers=admin_headers).json()
    rejected = next((v for v in versions if v["status"] == "rejected"), None)
    assert rejected is not None

    assert client.post(
        f"/api/models/versions/{rejected['id']}/rollback",
        headers=admin_headers,
        json={"reason": "без force"},
    ).status_code == 409

    forced = client.post(
        f"/api/models/versions/{rejected['id']}/rollback",
        headers=admin_headers,
        json={"reason": "Сознательный откат на экспериментальную версию", "force": True},
    )
    assert forced.status_code == 200
    assert forced.json()["status"] == "production"

    # Возвращаем эталонные веса, чтобы не влиять на остальные тесты
    baseline = next(v for v in client.get("/api/models/versions", headers=admin_headers).json() if v["source"] == "baseline")
    assert client.post(
        f"/api/models/versions/{baseline['id']}/rollback",
        headers=admin_headers,
        json={"reason": "Возврат эталона после теста force-отката"},
    ).status_code == 200


def test_missing_version_returns_404(client, admin_headers):
    assert client.post(
        "/api/models/versions/999999/rollback",
        headers=admin_headers,
        json={"reason": "нет такой версии"},
    ).status_code == 404


def test_gate_info_endpoint(client, admin_headers):
    response = client.get("/api/models/gate", headers=admin_headers)
    assert response.status_code == 200
    payload = response.json()
    assert payload["production"] is not None
    assert payload["tolerance"] == settings.MAP50_ROLLBACK_TOLERANCE
    assert isinstance(payload["recent_rejections"], list)


def test_activate_version_helper_is_idempotent(tmp_path):
    db = SessionLocal()
    try:
        version = register_version(
            db,
            weights_path=_copy_weights(tmp_path, "idempotent.pt"),
            metrics={"metrics/mAP50(B)": 0.95},
            label="idempotent-check",
            source="retrain",
        )
        activate_version(db, version, reason="тест идемпотентности")
        first_activation = version.activated_at
        activate_version(db, version, reason="повторная активация")
        assert first_activation is not None
        assert version.status == "production"
    finally:
        db.close()
