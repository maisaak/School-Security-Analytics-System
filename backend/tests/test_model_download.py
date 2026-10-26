import io

import pytest

from app.services.model_download import download_official_weights


class Response(io.BytesIO):
    def __init__(self, data, length):
        super().__init__(data)
        self.headers = {"Content-Length": str(length)}


def test_download_replaces_only_complete_file(tmp_path, monkeypatch):
    target = tmp_path / "yolo11n.pt"
    target.write_bytes(b"previous")
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **kw: Response(b"x" * 2048, 4096))
    with pytest.raises(RuntimeError, match="не завершена"):
        download_official_weights(target)
    assert target.read_bytes() == b"previous"
    assert list(tmp_path.iterdir()) == [target]
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **kw: Response(b"x" * 2048, 2048))
    download_official_weights(target)
    assert target.read_bytes() == b"x" * 2048


def test_download_rejects_unknown_asset(tmp_path):
    with pytest.raises(ValueError):
        download_official_weights(tmp_path / "untrusted.pt")
