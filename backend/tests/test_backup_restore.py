import json
import sqlite3

import pytest

from scripts.backup_data import create_backup
from scripts.restore_data import restore_backup, verify_backup


def sample(tmp_path):
    root = tmp_path / "source"
    root.mkdir()
    with sqlite3.connect(root / "school_security.db") as db:
        db.execute("CREATE TABLE items (name TEXT)")
        db.execute("INSERT INTO items VALUES ('saved')")
    (root / "media").mkdir()
    (root / "media" / "кадр.jpg").write_bytes(b"image-data")
    return root


def test_verified_restore_to_new_directory(tmp_path):
    root = sample(tmp_path)
    backup = create_backup(root, tmp_path / "backups")
    assert verify_backup(backup)["files"] == 2
    destination = restore_backup(backup, tmp_path / "restored")
    assert (destination / "media" / "кадр.jpg").read_bytes() == b"image-data"
    with sqlite3.connect(destination / "school_security.db") as db:
        assert db.execute("SELECT name FROM items").fetchone()[0] == "saved"
    assert not (destination / ".env").exists()
    with pytest.raises(ValueError):
        restore_backup(backup, destination)


def test_missing_database_not_marked_complete(tmp_path):
    with pytest.raises(ValueError):
        create_backup(tmp_path, tmp_path / "backups")
    assert not (tmp_path / "backups").exists()


@pytest.mark.parametrize("change", ["changed", "missing", "extra", "failed", "traversal"])
def test_corruption_rejected_before_destination_created(tmp_path, change):
    backup = create_backup(sample(tmp_path), tmp_path / "backups")
    image = backup / "media" / "кадр.jpg"
    if change == "changed":
        image.write_bytes(b"bad")
    elif change == "missing":
        image.unlink()
    elif change == "extra":
        (backup / "unexpected").write_text("extra")
    elif change == "failed":
        (backup / "BACKUP_FAILED.txt").touch()
    else:
        manifest = json.loads((backup / "manifest.json").read_text(encoding="utf-8"))
        manifest["files"][0]["path"] = "../escape"
        (backup / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    destination = tmp_path / "restored"
    with pytest.raises(ValueError):
        restore_backup(backup, destination)
    assert not destination.exists()


def test_backup_refuses_linked_secrets(tmp_path):
    root = sample(tmp_path)
    secret = tmp_path / "secret"
    secret.write_text("private")
    try:
        (root / "media" / "linked").symlink_to(secret)
    except OSError:
        pytest.skip("Creating symlinks requires OS permission")
    with pytest.raises(ValueError):
        create_backup(root, tmp_path / "backups")


def test_restore_rejects_nested_destination_without_mutating_backup(tmp_path):
    backup = create_backup(sample(tmp_path), tmp_path / "backups")
    destination = backup / "nested" / "restored"
    with pytest.raises(ValueError):
        restore_backup(backup, destination)
    assert not (backup / "nested").exists()
    assert verify_backup(backup)["files"] == 2


def test_existing_destination_is_never_overwritten(tmp_path):
    backup = create_backup(sample(tmp_path), tmp_path / "backups")
    destination = tmp_path / "live"
    destination.mkdir()
    sentinel = destination / "school_security.db"
    sentinel.write_bytes(b"do-not-touch")
    with pytest.raises(ValueError):
        restore_backup(backup, destination)
    assert sentinel.read_bytes() == b"do-not-touch"
    assert sorted(path.name for path in destination.iterdir()) == ["school_security.db"]


def test_copied_corruption_marks_restore_failed_and_preserves_source(tmp_path, monkeypatch):
    from scripts import restore_data

    backup = create_backup(sample(tmp_path), tmp_path / "backups")
    original_copy = restore_data.shutil.copy2
    destination = tmp_path / "restored"

    def corrupt_copy(source, target, *args, **kwargs):
        result = original_copy(source, target, *args, **kwargs)
        if str(target).endswith("school_security.db"):
            from pathlib import Path
            Path(target).write_bytes(b"corrupted-during-copy")
        return result

    monkeypatch.setattr(restore_data.shutil, "copy2", corrupt_copy)
    with pytest.raises(ValueError):
        restore_backup(backup, destination)
    assert (destination / "BACKUP_FAILED.txt").is_file()
    with pytest.raises(ValueError):
        verify_backup(destination)
    assert verify_backup(backup)["files"] == 2


@pytest.mark.parametrize("change", ["duplicate", "wrong_hash", "wrong_size", "missing_database"])
def test_invalid_manifest_refused_before_restore(tmp_path, change):
    backup = create_backup(sample(tmp_path), tmp_path / "backups")
    path = backup / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if change == "duplicate":
        manifest["files"].append(dict(manifest["files"][0]))
    elif change == "wrong_hash":
        manifest["files"][0]["sha256"] = "0" * 64
    elif change == "wrong_size":
        manifest["files"][0]["size"] += 1
    else:
        manifest["files"] = [item for item in manifest["files"] if item["path"] != "school_security.db"]
    path.write_text(json.dumps(manifest), encoding="utf-8")
    destination = tmp_path / "restored"
    with pytest.raises(ValueError):
        restore_backup(backup, destination)
    assert not destination.exists()
