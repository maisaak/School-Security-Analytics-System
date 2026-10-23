# Миграции Alembic

Схема развивается двумя механизмами:

* `ensure_schema()` при старте backend — мягкая dev-миграция SQLite (досоздаёт
  таблицы и колонки), чтобы демо-стенд поднимался без ручных команд;
* Alembic — версионированные миграции для production/PostgreSQL.

```bash
cd backend
alembic upgrade head                 # применить миграции
alembic revision --autogenerate -m "add feature"   # новая миграция
alembic stamp head                   # пометить существующую БД как актуальную
```
