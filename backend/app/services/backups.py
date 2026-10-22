from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import PROJECT_ROOT, settings
from app.db.session import engine


def database_path() -> Path | None:
    url = settings.DATABASE_URL
    if not url.startswith("sqlite"):
        return None
    raw = url.split("///", 1)[-1]
    path = Path(raw)
    return path if path.is_absolute() else (PROJECT_ROOT / path)


def manifest(path: Path) -> dict:
    stat = path.stat()
    return {
        "filename": path.name,
        "size_bytes": stat.st_size,
        "size_mb": round(stat.st_size / 1024**2, 2),
        "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(timespec="seconds"),
    }


def list_backups() -> dict:
    settings.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(settings.BACKUP_DIR.glob("school_security_*.*"), key=lambda p: p.stat().st_mtime, reverse=True)
    items = [manifest(path) for path in files if path.suffix in {".sqlite3", ".dump"}]
    return {
        "dir": str(settings.BACKUP_DIR),
        "database": "sqlite" if database_path() else "postgresql",
        "items": items,
        "keep": settings.BACKUP_KEEP,
    }


def create_backup() -> dict:
    """Консистентная копия БД: sqlite backup API либо pg_dump --format=custom."""
    settings.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    db_path = database_path()

    if db_path is not None:
        target = settings.BACKUP_DIR / f"school_security_{stamp}.sqlite3"
        source = sqlite3.connect(str(db_path))
        try:
            destination = sqlite3.connect(str(target))
            try:
                source.backup(destination)
            finally:
                destination.close()
        finally:
            source.close()
        engine_name = "sqlite"
    else:
        target = settings.BACKUP_DIR / f"school_security_{stamp}.dump"
        url = settings.DATABASE_URL.replace("postgresql+psycopg2://", "postgresql://")
        proc = subprocess.run(
            ["pg_dump", "--dbname", url, "--format", "c", "--file", str(target)],
            capture_output=True,
            timeout=300,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"pg_dump завершился с ошибкой: {proc.stderr.decode('utf-8', 'replace')[:300]}")
        engine_name = "postgresql"

    data = manifest(target)
    data["engine"] = engine_name
    (target.with_suffix(target.suffix + ".json")).write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Ротация: храним только последние BACKUP_KEEP копий
    kept = sorted(
        [path for path in settings.BACKUP_DIR.glob("school_security_*.*") if path.suffix in {".sqlite3", ".dump"}],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for old in kept[settings.BACKUP_KEEP:]:
        old.unlink(missing_ok=True)
        Path(str(old) + ".json").unlink(missing_ok=True)
    return data


def restore_backup(filename: str) -> dict:
    """Восстановление SQLite-базы. Перед перезаписью делается страховочная копия."""
    source = settings.BACKUP_DIR / Path(filename).name
    if not source.is_file() or source.suffix != ".sqlite3":
        raise FileNotFoundError(filename)
    target = database_path()
    if target is None:
        raise NotImplementedError("Для PostgreSQL используйте pg_restore")
    if not target.is_file():
        raise FileNotFoundError(str(target))

    safety = settings.BACKUP_DIR / f"before_restore_{datetime.now().strftime('%Y%m%d_%H%M%S')}.sqlite3"
    shutil.copy2(target, safety)
    engine.dispose()
    for suffix in ("-wal", "-shm"):
        Path(str(target) + suffix).unlink(missing_ok=True)
    shutil.copy2(source, target)
    engine.dispose()
    return {"status": "restored", "source": source.name, "safety_copy": safety.name, "restart_required": False}
