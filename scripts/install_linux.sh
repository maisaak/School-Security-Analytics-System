#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
command -v python3.13 >/dev/null || { echo "Нужен Python 3.13" >&2; exit 1; }
command -v node >/dev/null || { echo "Нужен Node.js 22 LTS" >&2; exit 1; }
python3.13 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r backend/requirements.txt
[[ -f .env ]] || .venv/bin/python scripts/setup_env.py
(cd frontend && npm ci)
echo "Готово. Запустите ./scripts/start_linux.sh"
