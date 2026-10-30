"""Capture executes in a killable child, not an uninterruptible timeout thread."""
import base64
import json
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

PROBE_LIMIT = threading.BoundedSemaphore(2)
PROBE_TIMEOUT = 8


def result(ok=False, latency_ms=0, width=None, height=None, preview_data_url=None, error_code=None, message=""):
    return dict(ok=ok, latency_ms=latency_ms, width=width, height=height, preview_data_url=preview_data_url, error_code=error_code, message=message)


def probe_stream(source):
    if not PROBE_LIMIT.acquire(blocking=False):
        return result(error_code="busy", message="Проверки заняты. Повторите позже.")
    start = time.monotonic()
    try:
        with tempfile.TemporaryDirectory(prefix="camera-probe-") as folder:
            output = Path(folder) / "preview.jpg"
            process = subprocess.Popen([sys.executable, "-m", "app.services.camera_probe", str(output)], cwd=str(Path(__file__).resolve().parents[2]), stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                process.communicate(json.dumps(source).encode(), timeout=PROBE_TIMEOUT)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
                return result(latency_ms=round((time.monotonic()-start)*1000), error_code="timeout", message="Превышено время ожидания потока")
            if output.with_suffix(".rejected").is_file():
                return result(error_code="rejected", message="Источник запрещён политикой сервера или DNS-имя недоступно")
            if process.returncode or not output.is_file() or output.stat().st_size > 250_000:
                return result(error_code="unavailable", message="Не удалось получить кадр")
            import cv2
            import numpy as np
            frame = cv2.imdecode(np.frombuffer(output.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                return result(error_code="unavailable", message="Не удалось декодировать кадр")
            dimensions = output.with_suffix(".json")
            if not dimensions.is_file() or dimensions.stat().st_size > 128:
                return result(error_code="unavailable", message="Не удалось определить размер кадра")
            width, height = json.loads(dimensions.read_text())
            return result(True, round((time.monotonic()-start)*1000), width, height, "data:image/jpeg;base64," + base64.b64encode(output.read_bytes()).decode(), message="Поток доступен")
    except (OSError, ValueError):
        return result(error_code="unavailable", message="Проверка потока недоступна")
    finally:
        PROBE_LIMIT.release()


def _capture():
    import cv2
    source = json.loads(sys.stdin.buffer.read(4096))
    from app.core.security import validate_stream_source
    from fastapi import HTTPException
    try:
        source = validate_stream_source(source)
    except HTTPException:
        Path(sys.argv[1]).with_suffix(".rejected").touch()
        return
    if source.startswith(("sim://", "demo://")):
        from app.services.simulator import RealisticCCTVSimulator
        frame = RealisticCCTVSimulator(source).read_frame()
    else:
        cap = cv2.VideoCapture(0 if source == "webcam" else source)
        try:
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError("No frame")
        finally:
            cap.release()
    h, w = frame.shape[:2]
    Path(sys.argv[1]).with_suffix(".json").write_text(json.dumps([w, h]))
    scale = min(1, 640/w, 480/h)
    frame = cv2.resize(frame, (max(1, int(w*scale)), max(1, int(h*scale))))
    ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not ok:
        raise RuntimeError("Cannot encode preview")
    Path(sys.argv[1]).write_bytes(encoded.tobytes())


if __name__ == "__main__":
    _capture()
