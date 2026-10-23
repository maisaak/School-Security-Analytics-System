#!/usr/bin/env python3
"""Резервное копирование БД школы (SQLite backup API или pg_dump).

Пример cron: 0 2 * * * cd /opt/school && .venv/bin/python scripts/backup_db.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.backups import create_backup, list_backups  # noqa: E402


def main() -> int:
    result = create_backup()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"Всего копий: {len(list_backups()['items'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
