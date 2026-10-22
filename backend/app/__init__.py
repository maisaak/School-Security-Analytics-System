"""School Security Analytics System backend package.

Добавляем корень репозитория в sys.path, чтобы `ml.*` (датасет, пайплайн обучения)
импортировался и при запуске `cd backend && uvicorn app.main:app`.
"""

from __future__ import annotations

import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.append(str(_PROJECT_ROOT))
