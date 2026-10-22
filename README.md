# 🏫 School Security Analytics System

Интеллектуальная система видеомониторинга безопасности для образовательных учреждений с детекцией угроз и нарушений в реальном времени с помощью нейросетей **YOLOv8 (Ultralytics)**.

## 📋 Возможности

- **Детекция нарушений (Real YOLOv8 Inference)**:
  - `weapon` — обнаружение огнестрельного и холодного оружия (критический уровень тревоги)
  - `suspicious_bag` — обнаружение бесхозных / оставленных сумок, рюкзаков и чемоданов (с пространственной проверкой отсутствия владельца рядом)
  - `dog` — обнаружение безнадзорных собак на территории школы
- **Управление камерами**: добавление, приостановка и удаление RTSP / HTTP / симулируемых камер в реальном времени (`MJPEG` live-поток + телеметрия FPS и задержки инференса)
- **Панель аналитики и архив инцидентов**: фильтрация по типу угрозы и камере, фотофиксация кадра с разметкой и воспроизведение H.264 `.mp4` видеофрагмента прямо в браузере
- **Лаборатория проверки медиа**: загрузка произвольных фотографий и видеороликов для мгновенной проверки детектора YOLOv8
- **Дообучение модели (`Retrain`)**: загрузка новых размеченных примеров в датасет и запуск дообучения `YOLOv8` через очередь задач `Celery + Redis` (с автоматическим локальным воркером в dev-режиме и горячей перезагрузкой весов без остановки камер)

## 🏗️ Структура проекта

```text
School-Security-Analytics-System/
├── backend/                 # FastAPI сервер
│   ├── app/
│   │   ├── main.py          # Точка входа и управление жизненным циклом потоков
│   │   ├── api/             # REST & Streaming API роуты и Pydantic-схемы
│   │   ├── core/            # Конфигурация приложения (Pydantic Settings)
│   │   ├── models/          # Ансамбль детекторов YOLOv8 и бизнес-правила угроз
│   │   ├── services/        # Менеджер RTSP-потоков, FFmpeg-запись клипов, Celery-задачи
│   │   └── db/              # SQLAlchemy ORM модели и подключение к PostgreSQL / SQLite
│   ├── tests/               # Pytest автотесты API и ML-конвейера
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                # React 18 + TypeScript + TailwindCSS приложение
│   ├── src/
│   │   ├── components/      # UI-компоненты видеостены, карточек аналитики и таблиц
│   │   ├── pages/           # Страницы мониторинга, медиа-лаборатории и дообучения
│   │   ├── api/             # Типизированный API-клиент
│   │   └── App.tsx
│   ├── package.json
│   └── Dockerfile
├── ml/                      # ML модели, датасеты и пайплайн дообучения
│   ├── models/              # Предобученные и дообученные веса YOLOv8 (.pt)
│   ├── datasets/            # Конфигурация и генератор/хранилище датасета
│   └── train.py             # Скрипт дообучения YOLOv8 с метриками mAP50
├── docker-compose.yml       # Оркестрация PostgreSQL, Redis, FastAPI, Celery и Nginx/React
└── .env.example             # Пример переменных окружения
```

## 🚀 Быстрый старт

### Вариант 1: Docker Compose (Production / Full Stack)

```bash
cp .env.example .env
docker compose up -d --build
```

- **Фронтенд**: `http://localhost:3000`
- **Бэкенд API**: `http://localhost:8000`
- **Swagger документация**: `http://localhost:8000/docs`

### Вариант 2: Локальный запуск для разработки

```bash
# 1. Backend (FastAPI + YOLOv8 + SQLite)
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 2. Frontend (React + Vite)
cd frontend
npm install
npm run dev
```

## 📡 Основные API Endpoints

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| `POST` | `/api/cameras` | Добавить новую RTSP / видео / демо-камеру |
| `GET` | `/api/cameras` | Список камер с live-метриками FPS и статуса |
| `DELETE` | `/api/cameras/{id}` | Остановить поток и удалить камеру |
| `GET` | `/api/cameras/{id}/stream` | Живой MJPEG-видеопоток с разметкой YOLOv8 |
| `POST` | `/api/cameras/{id}/simulate` | Запустить тестовый сценарий на демо-камере |
| `GET` | `/api/violations` | Список зафиксированных нарушений с фильтрацией |
| `PATCH` | `/api/violations/{id}/ack` | Подтвердить отработку инцидента охраной |
| `GET` | `/api/violations/{id}/video` | Видеофрагмент нарушения (`H.264 MP4`) |
| `POST` | `/api/analyze/upload` | Проверить фото или видеофайл через YOLOv8 |
| `GET` | `/api/stats` | Сводная аналитика по угрозам, камерам и модели |
| `POST` | `/api/models/retrain` | Запустить задачу дообучения модели YOLOv8 |
| `GET` | `/api/models/jobs` | Статус и метрики (`mAP50`, `loss`) задач обучения |

## 🔧 Технологии

| Компонент | Технология |
|-----------|------------|
| Backend | FastAPI, Python 3.11, Pydantic v2, SQLAlchemy 2.0 |
| Frontend | React 18, TypeScript, Vite, TailwindCSS, Lucide Icons |
| ML / CV | YOLOv8, Ultralytics, PyTorch, OpenCV, FFmpeg |
| Database | PostgreSQL 15 (prod) + SQLite WAL (dev) |
| Queue | Celery 5 + Redis 7 |

## 📝 Лицензия

MIT
