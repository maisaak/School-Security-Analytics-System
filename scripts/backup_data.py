"""Create a local backup without copying virtualenvs or secrets into the archive."""
from __future__ import annotations

import argparse
import shutil
from datetime import datetime
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Backup local database, media and ML data")
    parser.add_argument("--output", type=Path, default=root / "backups")
    args = parser.parse_args()
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = args.output.resolve() / f"school_security_{stamp}"
    target.mkdir(parents=True, exist_ok=False)
    for name in ("school_security.db", "media", "ml/datasets/custom", "ml/models/candidates"):
        source = root / name
        if source.is_file():
            shutil.copy2(source, target / source.name)
        elif source.is_dir():
            shutil.copytree(source, target / source.name, dirs_exist_ok=True)
    print(f"Создана резервная копия: {target}")
    print("Файл .env намеренно не копируется. Сохраните его отдельно в защищённом месте.")


if __name__ == "__main__":
    main()
