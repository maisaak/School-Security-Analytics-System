from __future__ import annotations

import io
import time
import cv2
from fastapi.testclient import TestClient

from app.core.config import PROJECT_ROOT, settings
from app.main import app


def test_security_guards_and_full_pipeline():
    with TestClient(app) as client:
        # 1. Healthcheck и начальные сидированные камеры
        assert client.get("/health").status_code == 200
        initial_cams = client.get("/api/cameras").json()
        assert len(initial_cams) >= 3

        # 2. Проверка блокировки SSRF (loopback / metadata) и LFI (произвольный локальный путь)
        lfi_attempt = client.post(
            "/api/cameras",
            json={"name": "Evil LFI", "location": "Test", "rtsp_url": "/etc/passwd"},
        )
        assert lfi_attempt.status_code == 400

        ssrf_attempt = client.post(
            "/api/cameras",
            json={"name": "Evil SSRF", "location": "Test", "rtsp_url": "http://169.254.169.254/latest/meta-data"},
        )
        assert ssrf_attempt.status_code == 400

        loopback_attempt = client.post(
            "/api/cameras",
            json={"name": "Evil Loopback", "location": "Test", "rtsp_url": "http://127.0.0.1:8000/health"},
        )
        assert loopback_attempt.status_code == 400

        # 3. Проверка блокировки Path Traversal в dataset_yaml при дообучении
        traversal_retrain = client.post(
            "/api/models/retrain",
            json={"epochs": 1, "dataset_yaml": "../../etc/passwd"},
        )
        assert traversal_retrain.status_code == 400

        # 4. Добавление легитимной камеры (POST /api/cameras)
        add_res = client.post(
            "/api/cameras",
            json={
                "name": "Камера №4 — Спортивный зал",
                "location": "Блок Б, 1 этаж",
                "rtsp_url": "sim://hallway",
            },
        )
        assert add_res.status_code == 201
        cam_id = add_res.json()["id"]

        # 5. Симуляция инцидента и реальная детекция YOLOv8 + генерация MP4
        sim_res = client.post(f"/api/cameras/{cam_id}/simulate", json={"scenario": "dog"})
        assert sim_res.status_code == 200

        found_violation = None
        for _ in range(25):
            time.sleep(0.3)
            viols = client.get("/api/violations").json()
            if viols:
                found_violation = viols[0]
                break
        assert found_violation is not None

        # 6. Проверка отдачи H.264 MP4 видео нарушения
        vid_res = client.get(found_violation["video_url"])
        assert vid_res.status_code == 200
        assert vid_res.headers["content-type"].startswith("video/mp4")
        assert len(vid_res.content) > 1000

        # 7. Подтверждение и удаление инцидента с проверкой очистки медиафайлов с диска
        ack_res = client.patch(f"/api/violations/{found_violation['id']}/ack")
        assert ack_res.status_code == 200
        assert ack_res.json()["is_acknowledged"] is True

        snap_disk = settings.MEDIA_ROOT / found_violation["image_path"].removeprefix("/media/")
        assert snap_disk.is_file()
        del_viol = client.delete(f"/api/violations/{found_violation['id']}")
        assert del_viol.status_code == 204
        assert not snap_disk.exists()

        # 8. Проверка лимита размера загружаемого файла (защита от OOM DoS)
        prev_limit = settings.MAX_UPLOAD_IMAGE_MB
        settings.MAX_UPLOAD_IMAGE_MB = 1
        try:
            oversized = b"x" * (2 * 1024 * 1024)
            too_big_res = client.post(
                "/api/analyze/upload",
                files={"file": ("huge.jpg", io.BytesIO(oversized), "image/jpeg")},
            )
            assert too_big_res.status_code == 413
        finally:
            settings.MAX_UPLOAD_IMAGE_MB = prev_limit

        # 9. Проверка реальной детекции YOLOv8 на загруженном фото
        sample_img = cv2.imread(str(PROJECT_ROOT / "ml" / "assets" / "sprites" / "dog_white.png"))
        _, encoded = cv2.imencode(".jpg", sample_img)
        up_res = client.post(
            "/api/analyze/upload",
            files={"file": ("test_dog.jpg", io.BytesIO(encoded.tobytes()), "image/jpeg")},
            data={"save_violation": "false"},
        )
        assert up_res.status_code == 200
        assert any(v["type"] == "dog" for v in up_res.json()["violations"])

        # 10. Удаление камеры
        assert client.delete(f"/api/cameras/{cam_id}").status_code == 204
