#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ -x .venv/bin/python ]] || { echo "Сначала выполните ./scripts/install_linux.sh" >&2; exit 1; }
.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 > backend.log 2>&1 &
echo $! > .backend.pid
(cd frontend && npm run dev > ../frontend.log 2>&1 & echo $! > ../.frontend.pid)
echo "Запущено. Откройте http://localhost:3000"
