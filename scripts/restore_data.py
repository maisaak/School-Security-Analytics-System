"""Verify a backup and restore to a NEW directory, never over a live installation."""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
from pathlib import Path, PurePosixPath

try:
    from scripts.backup_data import DATA_FOLDERS, file_digest, safe_files
except ModuleNotFoundError:
    from backup_data import DATA_FOLDERS, file_digest, safe_files


def verify_backup(backup: Path) -> dict:
    backup = backup.resolve()
    if not (backup / "BACKUP_COMPLETE.txt").is_file() or (backup / "BACKUP_FAILED.txt").exists():
        raise ValueError("Копия не завершена или помечена ошибкой")
    for _ in safe_files(backup):
        pass
    manifest_file = backup / "manifest.json"
    if not manifest_file.is_file() or manifest_file.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("Манифест отсутствует или превышает лимит")
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or manifest.get("version") != 1 or not isinstance(manifest.get("files"), list):
        raise ValueError("Неподдерживаемый манифест")
    names = set()
    for item in manifest["files"]:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("Некорректная запись манифеста")
        name = item["path"]
        rel = PurePosixPath(name)
        if rel.is_absolute() or ".." in rel.parts or "\\" in name or ":" in name or name != rel.as_posix() or name in names:
            raise ValueError("Некорректный путь в манифесте")
        if name != "school_security.db" and not any(name.startswith(folder + "/") for folder in DATA_FOLDERS):
            raise ValueError("Манифест содержит посторонний файл")
        path = backup / name
        if not path.is_file() or not path.resolve().is_relative_to(backup) or path.stat().st_size != item.get("size") or file_digest(path) != item.get("sha256"):
            raise ValueError(f"Файл отсутствует или повреждён: {name}")
        names.add(name)
    actual = {path.relative_to(backup).as_posix() for path in safe_files(backup)} - {"manifest.json", "BACKUP_COMPLETE.txt"}
    if actual != names or "school_security.db" not in names:
        raise ValueError("Состав копии не совпадает с манифестом")
    with sqlite3.connect((backup / "school_security.db").as_uri() + "?mode=ro", uri=True) as db:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Нарушена целостность SQLite")
    return {"files": len(names), "bytes": sum(item["size"] for item in manifest["files"])}


def restore_backup(backup: Path, destination: Path) -> Path:
    backup, destination = backup.resolve(), destination.resolve()
    if destination.exists() or destination == backup or destination.is_relative_to(backup):
        raise ValueError("Восстановление допускается только в новую папку вне резервной копии")
    verify_backup(backup)
    destination.mkdir(parents=True, exist_ok=False, mode=0o700)
    try:
        shutil.copy2(backup / "school_security.db", destination / "school_security.db")
        for folder in DATA_FOLDERS:
            if (backup / folder).is_dir():
                shutil.copytree(backup / folder, destination / folder, symlinks=True)
        # Recheck the copied bytes, not just the source before copying.
        shutil.copy2(backup / "manifest.json", destination / "manifest.json")
        shutil.copy2(backup / "BACKUP_COMPLETE.txt", destination / "BACKUP_COMPLETE.txt")
        verify_backup(destination)
    except Exception:
        (destination / "BACKUP_FAILED.txt").write_text("Восстановление не завершено. Не запускайте эту копию.", encoding="utf-8")
        raise
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--destination", type=Path)
    args = parser.parse_args()
    result = restore_backup(args.backup, args.destination) if args.destination else verify_backup(args.backup)
    print(result)
    print("Проверка целостности не подтверждает подлинность копии. .env хранится отдельно.")


if __name__ == "__main__":
    main()
