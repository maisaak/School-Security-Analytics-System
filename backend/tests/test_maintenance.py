import os
import time

from app.core.config import settings
from app.services.maintenance import cleanup_media


def test_unreferenced_old_upload_is_cleaned_but_saved_one_survives(client):
    from test_api import upload
    saved = upload(client, True).json()["result_url"]
    orphan = settings.MEDIA_ROOT / "uploads/analyzed_old.jpg"
    orphan.write_bytes(b"old")
    old_time = time.time() - 48 * 3600
    os.utime(orphan, (old_time, old_time))
    saved_path = settings.MEDIA_ROOT / saved.removeprefix("/media/")
    os.utime(saved_path, (old_time, old_time))
    cleanup_media()
    assert not orphan.exists()
    assert saved_path.is_file()
