from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

is_sqlite = settings.DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False, "timeout": 15} if is_sqlite else {}

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
)

if is_sqlite:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute("PRAGMA busy_timeout=5000;")
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_schema() -> None:
    """
    Создаёт таблицы и мягко досоздаёт новые колонки в существующей dev-базе SQLite
    (лёгкая миграция v1 -> v2 без внешнего Alembic).
    """
    Base.metadata.create_all(bind=engine)
    if not is_sqlite:
        return

    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table_name, table in Base.metadata.tables.items():
            if table_name not in existing_tables:
                continue
            present = {col["name"] for col in inspector.get_columns(table_name)}
            for column in table.columns:
                if column.name in present:
                    continue
                ddl_type = column.type.compile(dialect=engine.dialect)
                default_clause = ""
                if column.default is not None and getattr(column.default, "is_scalar", False):
                    value = column.default.arg
                    if isinstance(value, bool):
                        default_clause = f" DEFAULT {1 if value else 0}"
                    elif isinstance(value, (int, float)):
                        default_clause = f" DEFAULT {value}"
                    elif isinstance(value, str):
                        safe = value.replace("'", "''")
                        default_clause = f" DEFAULT '{safe}'"
                conn.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN "{column.name}" {ddl_type}{default_clause}'))
