#!/usr/bin/env python3
"""Восстановление БД из резервной копии.

Использование: python scripts/restore_db.py school_security_20260101_020000.sqlite3
Остановите backend перед восстановлением постгресового дампа:
  pg_restore --clean --if-exists -d "$DATABASE_URL" backups/school_security_*.dump
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.backups import restore_backup  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print("Укажите имя файла резервной копии из backups/", file=sys.stderr)
        return 2
    result = restore_backup(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
