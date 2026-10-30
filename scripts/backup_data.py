"""Create a local backup without copying virtualenvs or secrets into the archive."""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import hashlib
import json
from datetime import datetime
from pathlib import Path


DATA_FOLDERS = ("media", "ml/datasets/custom", "ml/models/candidates")


def is_link(path: Path) -> bool:
    return path.is_symlink() or getattr(path, "is_junction", lambda: False)()


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_files(root: Path):
    for path in root.rglob("*"):
        if is_link(path):
            raise ValueError("Ссылки и junction не допускаются в резервной копии")
        if path.is_file():
            yield path


def create_backup(root: Path, output: Path) -> Path:
    root, output = root.resolve(), output.resolve()
    sources = DATA_FOLDERS
    if any(output == root / name or root / name in output.parents for name in sources):
        raise ValueError("Папка резервных копий не должна находиться внутри копируемых данных")
    database = root / "school_security.db"
    if not database.is_file() or database.is_symlink():
        raise ValueError("Стандартная SQLite-база не найдена. Копия не создана; для другой БД используйте её штатные средства.")
    for name in sources:
        source = root / name
        if is_link(source):
            raise ValueError("Исходные каталоги не должны быть ссылками")
        if source.is_dir():
            # Refuse links before copytree follows them, including links to secrets.
            for _ in safe_files(source):
                pass
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    target = output / f"school_security_{stamp}"
    target.mkdir(parents=True, exist_ok=False, mode=0o700)
    try:
        database = root / "school_security.db"
        if database.is_file():
            # SQLite backup API includes committed WAL pages and works while API is running.
            with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as source:
                with sqlite3.connect(target / database.name) as destination:
                    source.backup(destination)
                    if destination.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                        raise RuntimeError("Проверка целостности резервной базы не пройдена")
        for name in sources:
            source = root / name
            if source.is_dir():
                def copy_file(src, dst):
                    path = Path(src)
                    if is_link(path):
                        raise ValueError("Исходный файл заменён ссылкой")
                    return shutil.copy2(src, dst)
                shutil.copytree(source, target / name, copy_function=copy_file, symlinks=True)
        files = [{"path": path.relative_to(target).as_posix(), "size": path.stat().st_size, "sha256": file_digest(path)} for path in sorted(safe_files(target))]
        (target / "manifest.json").write_text(json.dumps({"version": 1, "created_at": datetime.now().isoformat(), "files": files}, ensure_ascii=False, indent=2), encoding="utf-8")
        (target / "BACKUP_COMPLETE.txt").write_text(
            "Резервная копия завершена. База SQLite проверена.\n"
            "Медиа и модели копируются последовательно; для согласованного снимка всех файлов остановите запись и обучение.\n"
            "Секреты .env не включены.\n", encoding="utf-8",
        )
    except Exception:
        # Keep partial data for diagnostics, but never mark it as a complete backup.
        (target / "BACKUP_FAILED.txt").write_text("Копия не завершена. Не используйте для восстановления.\n", encoding="utf-8")
        raise
    return target


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Backup local database, media and ML data")
    parser.add_argument("--output", type=Path, default=root / "backups")
    args = parser.parse_args()
    target = create_backup(root, args.output)
    print(f"Создана резервная копия: {target}")
    print("Файл .env намеренно не копируется. Сохраните его отдельно в защищённом месте.")


if __name__ == "__main__":
    main()
