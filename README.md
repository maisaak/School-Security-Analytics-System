<p align="center">
  <img src="frontend/public/brand/logo.png" alt="Лицей №6 «Перспектива»" width="140" />
</p>

# 🏫 Аналитика безопасности школы · v2.1

Платформа видеомониторинга для **Лицея №6 «Перспектива»**: детекция угроз и нарушений в реальном времени с помощью нейросетей **YOLOv8 / YOLO11 (Ultralytics)**, тревоги для охраны, журнал инцидентов и аудит.

**v2.1 (v3-функции) — что добавлено**: Telegram-оповещения с подтверждением тревоги прямо в боте, live-лента SSE с тостами, звуком и счётчиком в заголовке вкладки, полноэкранная видеостена с автосменой камер, SLA реакции охраны, PDF/Excel-отчёты с водяным знаком, теплокарта инцидентов, зоны ROI с рисованием в UI, расписание и пороги уверенности по камере, активное обучение, A/B-моделей, экспорт ONNX/TensorRT, режим эвакуации, гостевые пропуска, 2FA (TOTP), ограничение доступа к камерам, watchdog, политика хранения медиа, резервное копирование БД, Prometheus-метрики, Alembic и CI.

**v2.0**: аутентификация JWT + HttpOnly cookie, 3 роли с быстрым входом, трекинг и таймер выдержки бесхозной сумки, Validation Gate + реестр версий весов с откатом, маскирование RTSP-кредов и полный журнал аудита.

---

## 🔐 Роли и доступ

| Роль | Логин / пароль (демо) | Возможности |
|------|----------------------|-------------|
| **Администратор** (`admin`) | `admin` / `admin123` | Полный доступ: камеры, удаление улик, дообучение YOLOv8 и откат весов, управление пользователями, аудит |
| **Директор** (`director`) | `director` / `director123` | Живой просмотр камер, аналитика и отчёты, подтверждение тревог, режим эвакуации, гостевые пропуска, журнал аудита |
| **Охранник КПП** (`guard`) | `guard` / `guard123` | Видеостена КПП, лента тревог, подтверждение отработки, гостевые пропуска, проверка медиафайлов |

> **2FA** (TOTP) настраивается самостоятельно в «Настройках» → «Безопасность учётной записи».
> Администратор может сбросить 2FA, снять блокировку после неудачных входов и ограничить
> пользователю список доступных камер в разделе «Безопасность и доступ».

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
- **Свои веса и YOLO11** — `POST /api/models/upload`:
  - загрузка любого чекпоинта Ultralytics `.pt` (YOLOv8 / YOLO11 / YOLOv10 / YOLOv9, до 200 МБ);
  - архитектура, задача и список классов определяются автоматически (`inspect_weights`), выбор «YOLO11» в UI сверяется с файлом;
  - чужой формат (`.onnx`, `.pt` с задачей не `detect`, модель с одним классом) отсекается до записи в реестр;
  - если указан mAP@50, применяется тот же **Validation Gate**, что и для дообучения: деградация блокирует активацию, версия остаётся кандидатом;
  - версию можно удалить из реестра (`DELETE /api/models/versions/{id}`), боевую — только после отката.
- **Персональные настройки интерфейса** (`/api/settings/preferences`):
  - тема (тёмная / светлая / контрастная), акцентный цвет (изумруд / индиго / небо / янтарь / роза);
  - набор KPI на дашборде: камеры, нарушения, критические инциденты, выдержка, задержка, уверенность;
  - компактные таблицы, скрытие графика динамики, нижняя навигация на телефоне — настройки хранятся в профиле пользователя и применяются на всех устройствах.
- **Выгрузка таблиц в CSV**: журнал нарушений (`/api/violations/export`) и журнал аудита (`/api/audit/export`) — разделитель `;`, UTF-8 с BOM, кириллица открывается в Excel без «кракозябр»; фильтры таблицы на дашборде переносятся в выгрузку.
- **Адаптивная вёрстка**: на телефоне — закреплённая нижняя навигация с бейджами тревог и шторка «Ещё», на планшете и десктопе — полноценное верхнее меню.
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
- **Live-события (SSE)**: `GET /api/events/stream` — новые инциденты, подтверждения, offline-камеры, режим эвакуации. Тосты, звуковой сигнал и счётчик в `document.title`; при недоступности SSE интерфейс продолжает работать на polling.
- **Telegram-оповещения**: оружие уходит директору **и** охране, бесхозные сумки и собаки — только охране; в сообщении есть кнопка «Подтвердить отработку» (callback), после нажатия фиксируется SLA реакции. Включается и проверяется в «Эксплуатации».
- **Видеостена поста охраны**: полноэкранный оверлей (F11 / Alt+W / кнопка), автосмена камер 5/10/20/30 с, пауза, ручной переход, полоса SLA смены, кнопка «Эвакуация» с подтверждением.
- **SLA реакции**: время от детекции до подтверждения — среднее, медиана, p95, просроченные, разбивка по сменам (день/ночь) и по охранникам, PDF-отчёт за смену.
- **Отчёты**: PDF (`reportlab`) и Excel (`openpyxl`) за произвольный период — сводка по типам, SLA, топ камер; в PDF и названии файла водяной знак «кто/когда выгрузил», каждая выгрузка пишется в аудит и в журнал выгрузок.
- **Теплокарта и качество**: матрица «день недели × час», топ камер по инцидентам и по ложным срабатываниям, доля ложных, средняя/медианная уверенность.
- **Отметка «ложное срабатывание»**: не попадает в датасет обучения, учитывается в отчёте качества и рейтинге камер.
- **Зоны ROI и политика камеры**: полигоны include/exclude с рисованием прямо по кадру, порог confidence, расписание анализа по дням и часам, доля кадров для A/B-профиля.
- **Активное обучение**: кадр инцидента одной кнопкой уходит в датасет (только admin, ложные срабатывания отклоняются).
- **Экспорт моделей**: ONNX и TensorRT engine из реестра версий (`POST /api/models/versions/{id}/export`), готовые артефакты — в «Эксплуатации».
- **Режим эвакуации**: все камеры разворачиваются на видеостене у охраны, баннер для директора, Telegram-сигнал, событие в SSE, активация/снятие — в аудите.
- **Гостевые пропуска**: регистрация посетителя, бейдж, срок действия, отметки входа/выхода, автоистечение и просроченные визиты. Отдельная вкладка «Гости» в шапке.
- **Эксплуатация**: watchdog RTSP-потоков (авто-reconnect + алерт offline), политика хранения медиа (срок, квота, автоочистка), резервное копирование и восстановление БД, Telegram-настройки, Prometheus `/metrics`, Sentry по `SENTRY_DSN`.
- **Безопасность**: 2FA TOTP + резервные коды, блокировка после серии неудачных входов, политика паролей, rate limit, ограничение доступа к камерам, водяной знак и размытие лиц при выгрузке кадра (152-ФЗ).

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
│   └── tests/                   # 71 pytest-тест: auth, RBAC, security, tracking, registry, upload, settings, API
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
cd backend && python -m pytest tests -q     # 93 теста
cd frontend && npx tsc --noEmit             # типы
cd frontend && npm run build                # production-сборка
```

CI (GitHub Actions, `.github/workflows/ci.yml`): `pytest` → `tsc --noEmit` → `vite build` → `docker build backend/Dockerfile`.

### Миграции и резервные копии

```bash
cd backend
alembic upgrade head                       # применить миграции (0001_initial)
alembic current                            # текущая ревизия
alembic revision --autogenerate -m "..."   # новая миграция после изменения моделей

python ../scripts/backup_db.py             # sqlite backup API или pg_dump
python ../scripts/restore_db.py --latest   # восстановление (создаёт страховочную копию)
```

В «Эксплуатации» те же операции доступны кнопками: создать копию, восстановить
(подтверждение словом `ВОССТАНОВИТЬ`), запустить очистку медиа, проверить Telegram."""

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

## 🎛️ Выбор YOLO-моделей и HLS вместо MJPEG

### Каталог моделей и профили детекции

Ансамбль состоит из трёх независимых моделей, и админ решает, какие из них
работают на каждой камере:

| Компонент | Веса | Что детектирует |
|-----------|------|-----------------|
| `coco` | `yolov8n.pt` | person, backpack/handbag/suitcase, dog, knife |
| `weapon` | `weapon_yolov8.pt` | guns, knife |
| `custom` | `school_security_best.pt` (боевая версия из реестра) | dog, weapon, suspicious_bag |

Готовые профили (`GET /api/detector/profiles`):

| Профиль | Модели | Когда нужен |
|---------|--------|-------------|
| `ensemble` | COCO + оружие + школа | максимальная полнота (по умолчанию) |
| `custom` | только школа | минимум CPU, школьные классы |
| `custom_weapon` | школа + оружие | КПП и рамки металлодетектора |
| `coco` | только COCO | люди и обстановка без дообучения |
| `weapon` | только оружие | дежурный режим на входе |

Профиль хранится в `cameras.detector_profile`, меняется админом прямо на карточке
камеры в разделе «Мониторинг» (`PATCH /api/cameras/{id}/detector`) и применяется
на лету — воркер переключает набор моделей без перезапуска потока. Каждое
переключение пишется в аудит как `camera.detector.update`.

`GET /api/models/catalog` отдаёт админу полную картину: файлы весов, их классы,
порог уверенности, размер, статус загрузки, профили с числом камер на каждом
и реестр версий с mAP@50 (боевую версию выбирают откатом/активацией из реестра).

### Почему RTSP играется через HLS, а не MJPEG

Браузер не умеет воспроизводить `rtsp://` напрямую. Раньше камера отдавалась
как MJPEG — поток JPEG-кадров, который перерисовывается в `<img>`: нет звука,
нет перемотки и буфера, высокий трафик. Теперь воркер камеры отдаёт уже
аннотированные кадры (рамки YOLO + HUD) в `ffmpeg`, тот кодирует H.264 (main
profile, yuv420p) и режет на mpeg-ts сегменты по 1 секунде:

```
RTSP → OpenCV → YOLOv8 + аннотация → ffmpeg (libx264) → HLS (index.m3u8 + seg*.ts) → hls.js в браузере
```

- Плеер — обычный `<video>` через `hls.js` (Safari играет нативно), задержка ~2–3 с;
- сегменты и плейлист закрыты той же авторизацией, что и остальные эндпоинты
  (`Authorization`, cookie или `?token=` для `<img>`);
- если `ffmpeg` недоступен, браузер не умеет MSE или поток ещё не прогрелся,
  компонент `CameraStream` автоматически откатывается на MJPEG и показывает
  об этом плашку — камеры остаются рабочими в любом окружении;
- на карточке видно источник (`RTSP`/`SIM`) и текущий режим (`HLS`/`MJPEG`),
  а переключатель в углу кадра позволяет сравнить оба режима.

Настройки: `HLS_ENABLED`, `HLS_SEGMENT_SEC`, `HLS_MAX_SEGMENTS`, `HLS_VIDEO_CODEC`
и `DETECTOR_PROFILE` (профиль по умолчанию) — см. `.env.example`.

### Камеры и инциденты

| Метод | Эндпоинт | Роль | Описание |
|-------|----------|------|----------|
| `GET` | `/api/cameras` | все | Список камер (rtsp_url **замаскирован**) |
| `POST` | `/api/cameras` | admin | Добавить камеру |
| `POST` | `/api/cameras/{id}/toggle` | admin | Пауза / возобновление |
| `DELETE` | `/api/cameras/{id}` | admin | Удалить камеру и её улики |
| `GET` | `/api/cameras/{id}/stream` | все | MJPEG-фолбэк (cookie-авторизация) |
| `GET` | `/api/cameras/{id}/hls/index.m3u8` | все | HLS-плейлист камеры (H.264) |
| `GET` | `/api/cameras/{id}/hls/{segment}` | все | mpeg-ts сегмент (только `segNNNNN.ts`) |
| `PATCH` | `/api/cameras/{id}/detector` | admin | Выбор профиля YOLO для камеры |
| `GET` | `/api/detector/profiles` | все | Справочник профилей детекции |
| `POST` | `/api/cameras/{id}/simulate` | admin | Тестовый сценарий |
| `GET` | `/api/violations` | все | Журнал нарушений (track_id, dwell_seconds) |
| `GET` | `/api/violations/export` | все | CSV-выгрузка журнала с фильтрами таблицы (Excel, UTF-8 BOM) |
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
| `GET` | `/api/models/catalog` | admin, director | Каталог YOLO-моделей, профили, поддерживаемые архитектуры, HLS-статус |
| `POST` | `/api/models/upload` | admin | Загрузка своих весов `.pt` (YOLO11 и др.) + Validation Gate |
| `DELETE` | `/api/models/versions/{id}` | admin | Удаление версии из реестра (боевая — 409) |

### Журнал, отчёты и детекция (v2.1)

| Метод | Эндпоинт | Роль | Описание |
|-------|----------|------|----------|
| `GET` | `/api/violations/page` | все авторизованные | Пагинация, сортировка, фильтры по типу/камере/датам/ложным |
| `PATCH` | `/api/violations/{id}/false-alarm` | admin, director, guard | Отметить/снять «ложное срабатывание» |
| `POST` | `/api/violations/{id}/to-dataset` | admin | Активное обучение: кадр инцидента → датасет |
| `GET` | `/api/violations/{id}/snapshot` | все авторизованные | Кадр с водяным знаком, `blur_faces=true` — без лиц |
| `GET` | `/api/events/stream` | все авторизованные | SSE-лента событий (токен в `?token=`) |
| `GET` | `/api/events/recent` | все авторизованные | Последние события для polling-фолбэка |
| `GET` | `/api/analytics/sla` | admin, director | SLA реакции: avg/median/p95, просрочки, смены |
| `GET` | `/api/analytics/heatmap` | admin, director | Теплокарта и топ камер по ложным |
| `GET` | `/api/analytics/ab` | admin, director | Сравнение вариантов A/B |
| `GET` | `/api/analytics/quality` | admin, director | Доля ложных, уверенность, подтверждаемость |
| `GET` | `/api/analytics/reports/incidents.pdf` | admin, director | PDF-отчёт за период |
| `GET` | `/api/analytics/reports/incidents.xlsx` | admin, director | Excel-отчёт за период |
| `GET` | `/api/analytics/reports/sla.pdf` | admin, director | PDF-отчёт по SLA за смену |
| `GET` | `/api/analytics/reports/preview` | admin, director | Предпросмотр сводки и водяного знака |
| `GET/PUT` | `/api/cameras/{id}/zones` | admin | Полигоны ROI (include/exclude) |
| `GET/PATCH` | `/api/cameras/{id}/policy` | admin | Порог confidence, расписание, A/B |
| `GET` | `/api/models/exports` | admin | Готовые ONNX/TensorRT артефакты |
| `POST` | `/api/models/versions/{id}/export` | admin | Экспорт версии в ONNX / TensorRT |

### Эксплуатация, безопасность и школа (v2.1)

| Метод | Эндпоинт | Роль | Описание |
|-------|----------|------|----------|
| `GET` | `/api/ops/overview` | admin | БД, медиа, бэкапы, SSE, воркеры, метрики |
| `GET/PUT` | `/api/ops/notifications` | admin | Telegram: токен, чаты, категории |
| `POST` | `/api/ops/notifications/test` | admin | Проверка связи с ботом |
| `GET/PUT` | `/api/ops/retention` | admin | Срок хранения, квота, автоочистка |
| `POST` | `/api/ops/retention/cleanup` | admin | Немедленная очистка медиа |
| `GET/POST` | `/api/ops/backups` | admin | Список / создание резервной копии |
| `POST` | `/api/ops/backups/restore` | admin | Восстановление (`confirm=ВОССТАНОВИТЬ`) |
| `GET` | `/api/ops/watchdog` | admin | Состояние потоков и последние действия |
| `GET` | `/metrics` | публично (без деталей) | Prometheus-метрики |
| `GET/POST` | `/api/ops/emergency` | смотреть `emergency:trigger` | Режим эвакуации |
| `GET` | `/api/security/overview` | admin | 2FA, блокировки, политика паролей, выгрузки |
| `PUT` | `/api/security/users/{id}/camera-scope` | admin | Ограничение доступа к камерам |
| `POST` | `/api/security/users/{id}/2fa/reset` | admin | Сброс 2FA |
| `POST` | `/api/security/users/{id}/unlock` | admin | Снять блокировку |
| `GET/POST` | `/api/auth/2fa/{status,setup,enable,disable}` | все авторизованные | Самостоятельная настройка TOTP |
| `POST` | `/api/auth/password` | все авторизованные | Смена пароля с проверкой политики |
| `GET/POST` | `/api/visitors` | admin, director, guard | Гостевые пропуска |
| `POST` | `/api/visitors/{id}/{check-in,check-out,cancel}` | admin, director, guard | Отметки входа/выхода |

### Настройки интерфейса

| Метод | Эндпоинт | Роль | Описание |
|-------|----------|------|----------|
| `GET` | `/api/settings/preferences` | все авторизованные | Тема, акцент, KPI, плотность таблиц, мобильный нав |
| `PATCH` | `/api/settings/preferences` | все авторизованные | Сохранить настройки в профиль (аудит `settings.preferences.update`) |

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
