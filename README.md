# 🏫 School Security Analytics System · v2

Интеллектуальная система видеомониторинга безопасности для образовательных учреждений с детекцией угроз и нарушений в реальном времени с помощью нейросетей **YOLOv8 (Ultralytics)**.

**v2.0 — что добавлено**: аутентификация JWT + HttpOnly cookie, 3 роли с быстрым входом, трекинг и таймер выдержки бесхозной сумки, Validation Gate + реестр версий весов с откатом, маскирование RTSP-кредов и полный журнал аудита.

---

## 🔐 Роли и доступ

| Роль | Логин / пароль (демо) | Возможности |
|------|----------------------|-------------|
| **Администратор** (`admin`) | `admin` / `admin123` | Полный доступ: камеры, удаление улик, дообучение YOLOv8 и откат весов, управление пользователями, аудит |
| **Директор** (`director`) | `director` / `director123` | Живой просмотр камер, аналитика, просмотр и скачивание фото/видео инцидентов, подтверждение тревог, журнал аудита |
| **Охранник КПП** (`guard`) | `guard` / `guard123` | Видеостена КПП, лента тревог, подтверждение отработки, просмотр фото/видео нарушений, проверка медиафайлов |

На странице логина есть карточки **быстрого входа по роли** (endpoint `POST /api/auth/demo-login`, отключается через `DEMO_LOGIN_ENABLED=false`).

### Как устроена авторизация

* **JWT access-токен** (HS256, `sub` = id пользователя, TTL 12 ч) выдаётся в **HttpOnly cookie** `school_session` с `SameSite=Lax` и `Path=/`.
  Cookie автоматически прикладывается браузером и к `fetch`, и к тегам `<img src="/api/cameras/N/stream">` (MJPEG) и `<video src="/api/violations/N/video">` (H.264 MP4) — поэтому токен **не нужно** пробрасывать в query-параметрах.
* Дублирующие способы для внешних клиентов: `Authorization: Bearer <token>` и `?token=` (для плееров, не отправляющих cookie).
* Пароли — **PBKDF2-HMAC-SHA256**, 210 000 итераций, соль на пользователя. Сравнение через `hmac.compare_digest`.
* Матрица прав — `backend/app/core/permissions.py` (`Permission` × `Role`); проверка через зависимость `require_permissions(...)`; на каждый `403` пишется событие `access.denied` в аудит.
* Защита от перебора: окно попыток входа в памяти процесса (`LOGIN_RATE_LIMIT_ATTEMPTS` / `LOGIN_RATE_LIMIT_WINDOW_SEC`).
* Медиафайлы улик больше не раздаются публичным `StaticFiles`: маршрут `/media/{path}` требует действующей сессии.

---

## 📋 Возможности

- **Детекция нарушений (Real YOLOv8 Inference)**:
  - `weapon` — огнестрельное и холодное оружие (критический уровень тревоги);
  - `suspicious_bag` — бесхозные сумки/рюкзаки/чемоданы **с трекингом и таймером выдержки**;
  - `dog` — безнадзорные собаки на территории школы.
- **Трекинг (ByteTrack-подобный)** — `backend/app/services/tracking.py`:
  - двухэтапная ассоциация детекций (high/low confidence) по IoU + прогнозу центра объекта;
  - стабильный `track_id` (`BAG-12`) на всё время нахождения предмета в кадре;
  - **таймер выдержки**: тревога `suspicious_bag` поднимается не в момент появления предмета, а после `UNATTENDED_DWELL_SEC` (по умолчанию 6 с) без владельца рядом;
  - короткое перекрытие детекции в пределах `BAG_RELEASE_GRACE_SEC` **не сбрасывает** накопленное время, а возврат владельца — сбрасывает;
  - в кадре рисуется прогресс выдержки (`ВЫДЕРЖКА 3.4 / 6 c`), в API и на видеостене — прогресс-бар;
  - `dwell_seconds` и `track_id` сохраняются в записи инцидента; кулдаун тревог привязан к конкретному треку.
- **Validation Gate и реестр версий весов** — `backend/app/services/model_registry.py`:
  - каждая версия (baseline/retrain/rollback) регистрируется в таблице `model_versions` с `mAP@50`, `mAP@50-95`, SHA-256, размером и копией файла в `ml/versions/`;
  - после дообучения кандидат проходит gate: `mAP@50 ≥ baseline − MAP50_ROLLBACK_TOLERANCE` и `mAP@50 ≥ MAP50_MIN_ABSOLUTE`;
  - **при провале gate** боевые веса не подменяются: версия получает статус `rejected`, задача — `rejected`, событие пишется в аудит;
  - **при успехе** версия атомарно становится `production`, детектор перезагружает веса без остановки камер;
  - администратор может выполнить **Rollback** на любую версию реестра (`POST /api/models/versions/{id}/rollback`); для версии, отклонённой gate, требуется `force=true`.
- **Маскирование RTSP-кредов**:
  - `rtsp://admin:Secret@10.0.0.5/...` → `rtsp://a***:***@10.0.0.5/...` в API, UI и журнале аудита;
  - пароль остаётся только на сервере (камера продолжает работать);
  - `redact_secrets()` рекурсивно чистит `password`, `token`, `api_key`, `rtsp_url` в структурированных деталях аудита.
- **Полный журнал аудита** (`audit_log`): вход/выход, неудачные входы, отказы в доступе, CRUD камер, подтверждение и удаление улик, просмотр и скачивание видео, запуск дообучения, promotion/rejected версий, rollback, CRUD пользователей, экспорт CSV. Фильтры по действию/актору/исходу/поиску, пагинация, сводка, экспорт.
- **Управление камерами**: добавление, пауза, удаление RTSP / HTTP / симулируемых камер (`MJPEG` live-поток + телеметрия FPS и задержки инференса).
- **Панель аналитики и архив инцидентов**: фильтры по типу угрозы и камере, фотофиксация с разметкой, воспроизведение H.264 `.mp4` и скачивание.
- **Рабочее место охранника КПП**: видеостена, лента тревог с подсветкой новых событий и звуковым сигналом, подтверждение отработки.
- **Лаборатория проверки медиа**: загрузка произвольных фото и видео для мгновенной проверки детектора.
- **Дообучение модели**: загрузка размеченных примеров в датасет и обучение через очередь `Celery + Redis` (с локальным воркером в dev-режиме) с последующим Validation Gate.

---

## 🏗️ Структура проекта

```text
School-Security-Analytics-System/
├── backend/                     # FastAPI сервер
│   ├── app/
│   │   ├── main.py              # Точка входа, сиды демо-аккаунтов, реестра версий, камер
│   │   ├── api/
│   │   │   ├── auth_routes.py   # /api/auth: login, demo-login, logout, me, permissions
│   │   │   ├── routes.py        # камеры, нарушения, MJPEG, медиа-лаборатория, статистика
│   │   │   ├── model_routes.py  # дообучение, реестр версий, Validation Gate, rollback
│   │   │   ├── admin_routes.py  # пользователи и полный журнал аудита (+CSV)
│   │   │   ├── media_routes.py  # защищённая отдача улик (только с сессией)
│   │   │   ├── serializers.py   # маскирование rtsp_url, единые DTO
│   │   │   └── schemas.py       # Pydantic-схемы
│   │   ├── core/
│   │   │   ├── config.py        # Pydantic Settings (+ JWT/трекинг/gate)
│   │   │   ├── security.py      # PBKDF2, JWT, маскирование кредов, SSRF/LFI-гварды
│   │   │   ├── auth.py          # извлечение токена из cookie/Bearer, RBAC-зависимости
│   │   │   └── permissions.py   # роли и матрица прав
│   │   ├── models/detector.py   # ансамбль YOLOv8 + отрисовка треков и выдержки
│   │   ├── services/
│   │   │   ├── tracking.py      # IoUTracker (ByteTrack-подобный) + BagDwellMonitor
│   │   │   ├── model_registry.py# реестр версий, validation gate, promote, rollback
│   │   │   ├── audit.py         # запись AuditLog с редакцией секретов
│   │   │   ├── stream_manager.py# воркеры камер, MJPEG, запись клипов инцидентов
│   │   │   ├── tasks.py         # Celery-задачи дообучения + gate
│   │   │   └── simulator.py     # реалистичные CCTV-сцены для демо
│   │   └── db/                  # SQLAlchemy: users, cameras, violations, model_versions, audit_log
│   └── tests/                   # 45 pytest-тестов: auth, RBAC, security, tracking, registry, API
├── frontend/                    # React 18 + TypeScript + TailwindCSS
│   └── src/
│       ├── auth/AuthContext.tsx # сессия, права, реакция на 401
│       ├── pages/               # Login, Dashboard, Guard (КПП), Analytics, Lab, Training, Users, Audit
│       ├── components/          # видеостена, таблица нарушений, модалка видео, UI-кит
│       └── api/client.ts        # типизированный клиент (credentials: same-origin)
├── ml/                          # модели, датасеты, пайплайн дообучения
│   ├── models/                  # предобученные / дообученные веса YOLOv8
│   ├── versions/                # реестр версий весов (runtime, в .gitignore)
│   └── train.py                 # обучение с метриками mAP50 и staging-весами
├── docker-compose.yml           # PostgreSQL, Redis, FastAPI, Celery, Nginx/React
└── .env.example
```

---

## 🚀 Быстрый старт

### Вариант 1: локальный запуск

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt

# 1. Backend (FastAPI + YOLOv8 + SQLite)
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000

# 2. Frontend (React + Vite) — во втором терминале
cd frontend && npm install && npm run dev
```

- **Фронтенд**: `http://localhost:3000`
- **Swagger**: `http://localhost:8000/docs`

### Вариант 2: Docker Compose

```bash
cp .env.example .env
# обязательно задайте свой JWT_SECRET_KEY для production
docker compose up -d --build
```

### Тесты и сборка

```bash
cd backend && python -m pytest tests -q     # 48 тестов
cd frontend && npm run build                # tsc + vite build
```

---

## 📡 Основные API Endpoints

## Аутентификация (публичные)

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| `POST` | `/api/auth/login` | Вход по логину/паролю → JWT в HttpOnly cookie |
| `POST` | `/api/auth/demo-login` | Быстрый вход по роли (демо-аккаунты) |
| `POST` | `/api/auth/logout` | Выход, очистка cookie |
| `GET` | `/api/auth/me` | Текущий пользователь + права |
| `GET` | `/api/auth/demo-accounts` | Карточки ролей для страницы логина |

## 🪟 Вход в iframe-превью (Live Preview)

HttpOnly cookie `school_session` — основной транспорт сессии. Но встроенное превью
открывается в sandboxed iframe, где сторонние cookie блокируются: логин проходил,
а следующий же запрос возвращал `401` и пользователя выбрасывало на экран входа
(«Сессия истекла — войдите заново»).

Поэтому добавлен fallback, включённый по умолчанию (`AUTH_RETURN_TOKEN_IN_BODY=true`):

1. `POST /api/auth/login` возвращает JWT ещё и в теле — поле `access_token`.
2. Фронтенд держит токен в памяти и `sessionStorage` (`school_security_token`)
   и отправляет его заголовком `Authorization: Bearer <token>`.
3. Теги `<img>`, `<video>` и ссылки на скачивание не умеют слать заголовки,
   поэтому медиа-URL получают `?token=<token>` (`api.withToken()`).
4. Если превью-прокси вырезает и сам заголовок `Authorization`, клиент ловит `401`
   при живом токене, повторяет запрос с `?token=` и дальше работает в этом режиме
   (`api.getAuthMode()` → `bearer` | `query` | `cookie`).
5. Внизу страницы входа видна отметка сборки (`v2.1 · сборка …`) — по ней сразу
   понятно, что браузер загрузил свежий бандл, а не закешированный.

Порядок проверки токена на бэкенде: `Authorization: Bearer` → cookie `school_session`
→ query-параметр `token` (только для `/api/.../stream`, `/api/.../snapshot`,
`/api/violations/{id}/video` и `/media/*`). Cookie остаётся основным способом
для обычного браузера, Bearer-режим включается автоматически, когда cookie недоступны.

### Камеры и инциденты

| Метод | Эндпоинт | Роль | Описание |
|-------|----------|------|----------|
| `GET` | `/api/cameras` | все | Список камер (rtsp_url **замаскирован**) |
| `POST` | `/api/cameras` | admin | Добавить камеру |
| `POST` | `/api/cameras/{id}/toggle` | admin | Пауза / возобновление |
| `DELETE` | `/api/cameras/{id}` | admin | Удалить камеру и её улики |
| `GET` | `/api/cameras/{id}/stream` | все | MJPEG (cookie-авторизация) |
| `POST` | `/api/cameras/{id}/simulate` | admin | Тестовый сценарий |
| `GET` | `/api/violations` | все | Журнал нарушений (track_id, dwell_seconds) |
| `PATCH` | `/api/violations/{id}/ack` | admin, director, guard | Подтвердить отработку |
| `DELETE` | `/api/violations/{id}` | admin | Удалить улику + файлы |
| `GET` | `/api/violations/{id}/video` | все | MP4 фрагмент (`?download=true` для скачивания) |
| `POST` | `/api/analyze/upload` | все | Проверка фото/видео через YOLOv8 |
| `GET` | `/api/stats` | все | Аналитика (+ tracking, model) |
| `GET` | `/api/system/status` | все | Версия, схема авторизации, параметры gate |

### Дообучение и реестр версий

| Метод | Эндпоинт | Роль | Описание |
|-------|----------|------|----------|
| `POST` | `/api/models/retrain` | admin | Запуск дообучения |
| `GET` | `/api/models/jobs` | admin, director | Задачи обучения + результат gate |
| `GET` | `/api/models/versions` | admin, director | Реестр версий весов |
| `GET` | `/api/models/gate` | admin, director | Параметры gate и отклонённые версии |
| `POST` | `/api/models/versions/{id}/rollback` | admin | Откат на версию (`force` для rejected) |

### Администрирование

| Метод | Эндпоинт | Роль | Описание |
|-------|----------|------|----------|
| `GET/POST` | `/api/users` | admin | Список / создание пользователей |
| `PATCH/DELETE` | `/api/users/{id}` | admin | Изменение роли, статуса, пароля / удаление |
| `GET` | `/api/audit` | admin, director | Журнал аудита с фильтрами и пагинацией |
| `GET` | `/api/audit/summary` | admin, director | Сводка по событиям |
| `GET` | `/api/audit/export` | admin, director | Экспорт CSV |

---

## 🔧 Технологии

| Компонент | Технология |
|-----------|------------|
| Backend | FastAPI, Python 3.11, Pydantic v2, SQLAlchemy 2.0, PyJWT |
| Frontend | React 18, TypeScript, Vite, TailwindCSS, Lucide Icons |
| ML / CV | YOLOv8, Ultralytics, PyTorch, OpenCV, FFmpeg |
| Database | PostgreSQL 15 (prod) + SQLite WAL (dev) |
| Queue | Celery 5 + Redis 7 |

## 🔒 Замечания по безопасности

- В production задайте `JWT_SECRET_KEY`, `COOKIE_SECURE=true` (HTTPS) и `DEMO_LOGIN_ENABLED=false`.
- Демо-аккаунты помечены `is_demo=True` и предназначены для быстрого входа на стенде; их пароли можно сменить из панели администратора.
- Сохранены гварды v1: блокировка SSRF (loopback/link-local metadata), LFI через `rtsp_url`, path traversal в `dataset_yaml`, лимиты размера загрузок.
- `.jwt_secret`, `ml/versions/` и `media/` исключены из git.

## 📝 Лицензия

MIT
