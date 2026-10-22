from __future__ import annotations

import io
import time
import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.core.config import PROJECT_ROOT
from app.main import app


def test_full_school_security_api_pipeline():
    with TestClient(app) as client:
        # 1. Healthcheck и начальные сидированные камеры
        health = client.get("/health")
        assert health.status_code == 200

        cams_res = client.get("/api/cameras")
        assert cams_res.status_code == 200
        initial_cams = cams_res.json()
        assert len(initial_cams) >= 3

        # 2. Добавление новой камеры (POST /api/cameras)
        add_res = client.post(
            "/api/cameras",
            json={
                "name": "Камера №4 — Спортивный зал",
                "location": "Блок Б, 1 этаж",
                "rtsp_url": "sim://hallway",
            },
        )
        assert add_res.status_code == 201
        added_cam = add_res.json()
        cam_id = added_cam["id"]

        # 3. Симуляция инцидента и реальная детекция YOLOv8 + генерация MP4
        sim_res = client.post(f"/api/cameras/{cam_id}/simulate", json={"scenario": "dog"})
        assert sim_res.status_code == 200

        # Ждём реального прохода нейросети и записи клипа
        found_violation = None
        for _ in range(25):
            time.sleep(0.3)
            viols = client.get("/api/violations").json()
            if viols:
                found_violation = viols[0]
                break
        assert found_violation is not None
        assert found_violation["violation_type"] in {"dog", "weapon", "suspicious_bag"}

        # 4. Проверка отдачи H.264 MP4 видео нарушения (GET /api/violations/{id}/video)
        vid_res = client.get(found_violation["video_url"])
        assert vid_res.status_code == 200
        assert vid_res.headers["content-type"].startswith("video/mp4")
        assert len(vid_res.content) > 1000

        # 5. Подтверждение отработки инцидента охраной
        ack_res = client.patch(f"/api/violations/{found_violation['id']}/ack")
        assert ack_res.status_code == 200
        assert ack_res.json()["is_acknowledged"] is True

        # 6. Проверка интерактивной загрузки фото на анализ YOLOv8 (POST /api/analyze/upload)
        sample_img = cv2.imread(str(PROJECT_ROOT / "ml" / "assets" / "sprites" / "dog_white.png"))
        _, encoded = cv2.imencode(".jpg", sample_img)
        up_res = client.post(
            "/api/analyze/upload",
            files={"file": ("test_dog.jpg", io.BytesIO(encoded.tobytes()), "image/jpeg")},
            data={"save_violation": "false"},
        )
        assert up_res.status_code == 200
        up_json = up_res.json()
        assert any(v["type"] == "dog" for v in up_json["violations"])

        # 7. Удаление добавленной камеры (DELETE /api/cameras/{id})
        del_res = client.delete(f"/api/cameras/{cam_id}")
        assert del_res.status_code == 204

        # 8. Запуск реального дообучения модели (POST /api/models/retrain) на 1 эпоху
        retrain_res = client.post("/api/models/retrain", json={"epochs": 1})
        assert retrain_res.status_code == 200
        job_id = retrain_res.json()["id"]

        for _ in range(60):
            time.sleep(0.5)
            jobs = client.get("/api/models/jobs").json()
            target = next(j for j in jobs if j["id"] == job_id)
            if target["status"] in {"completed", "failed"}:
                break
        assert target["status"] == "completed"
        assert "metrics/mAP50(B)" in target["metrics"]
