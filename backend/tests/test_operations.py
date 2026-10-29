import sqlite3

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.main import app
from app.db.session import get_db
from scripts.backup_data import create_backup


def test_public_readiness_and_private_diagnostics(client):
    client.headers.pop("X-API-Key", None)
    response = client.get("/api/system/status")
    assert response.status_code == 200
    assert response.json() == {"api": "ok", "database": "ok"}
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/api/system/diagnostics").status_code == 401


def test_readiness_database_failure(client):
    class UnavailableDatabase:
        def execute(self, statement):
            raise SQLAlchemyError("private connection string")

    app.dependency_overrides[get_db] = lambda: UnavailableDatabase()
    try:
        response = client.get("/api/system/status")
        assert response.status_code == 503
        assert response.json() == {"api": "ok", "database": "unavailable"}
        assert "private" not in response.text
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_backup_includes_committed_wal_and_preserves_paths(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    database = sqlite3.connect(root / "school_security.db")
    try:
        database.execute("PRAGMA journal_mode=WAL")
        database.execute("CREATE TABLE example (value TEXT)")
        database.execute("INSERT INTO example VALUES ('committed')")
        database.commit()
        for folder in ("media", "ml/datasets/custom", "ml/models/candidates"):
            path = root / folder
            path.mkdir(parents=True)
            (path / "example.txt").write_text(folder)
        (root / ".env").write_text("SECRET=private")
        target = create_backup(root, root / "backups")
        with sqlite3.connect(target / "school_security.db") as saved:
            assert saved.execute("SELECT value FROM example").fetchone()[0] == "committed"
        assert (target / "ml/datasets/custom/example.txt").is_file()
        assert (target / "ml/models/candidates/example.txt").is_file()
        assert (target / "BACKUP_COMPLETE.txt").is_file()
        assert not (target / ".env").exists()
    finally:
        database.close()


def test_backup_rejects_recursive_output(tmp_path):
    with pytest.raises(ValueError):
        create_backup(tmp_path, tmp_path / "media" / "backups")
