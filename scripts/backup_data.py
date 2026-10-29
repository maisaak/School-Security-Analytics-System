"""Create a local backup without copying virtualenvs or secrets into the archive."""
from __future__ import annotations

import argparse
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path


def create_backup(root: Path, output: Path) -> Path:
    root, output = root.resolve(), output.resolve()
    sources = ("media", "ml/datasets/custom", "ml/models/candidates")
    if any(output == root / name or root / name in output.parents for name in sources):
        raise ValueError("Папка резервных копий не должна находиться внутри копируемых данных")
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    target = output / f"school_security_{stamp}"
    target.mkdir(parents=True, exist_ok=False)
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
                shutil.copytree(source, target / name)
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
