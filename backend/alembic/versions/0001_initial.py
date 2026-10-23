"""Базовая схема v3: пользователи, камеры, зоны, инциденты, СКУД и пропуска.

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-22

Базовая ревизия создаёт актуальную схему из SQLAlchemy-metadata. Для уже
существующей dev-базы выполните `alembic stamp head`, чтобы не создавать
таблицы повторно (на старте приложения их и так досоздаёт ensure_schema()).
"""
from __future__ import annotations

from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.db import models  # noqa: F401
    from app.db.session import Base

    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    from app.db import models  # noqa: F401
    from app.db.session import Base

    Base.metadata.drop_all(bind=op.get_bind())
