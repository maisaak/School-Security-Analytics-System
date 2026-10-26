"""Only download allowlisted official assets, atomically, with bounded size and time."""
from pathlib import Path
import time
import urllib.request
import uuid

OFFICIAL_FILENAMES = {f"{family}{size}.pt" for family in ("yolov8", "yolo11") for size in "nsmlx"}


def download_official_weights(target: Path) -> None:
    if target.name not in OFFICIAL_FILENAMES:
        raise ValueError("Неизвестные официальные веса")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{uuid.uuid4().hex}.download")
    deadline = time.monotonic() + 600
    total = 0
    try:
        url = f"https://github.com/ultralytics/assets/releases/download/v8.4.0/{target.name}"
        with urllib.request.urlopen(url, timeout=30) as response, temporary.open("xb") as output:
            expected = response.headers.get("Content-Length")
            expected = int(expected) if expected is not None else None
            if expected is not None and expected > 300 * 1024 * 1024:
                raise RuntimeError("Превышен лимит размера модели")
            while chunk := response.read(256 * 1024):
                total += len(chunk)
                if total > 300 * 1024 * 1024 or time.monotonic() > deadline:
                    raise RuntimeError("Превышен лимит загрузки модели")
                output.write(chunk)
        if total < 1024:
            raise RuntimeError("Пустые веса")
        if expected is not None and total != expected:
            raise RuntimeError("Загрузка весов не завершена")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
