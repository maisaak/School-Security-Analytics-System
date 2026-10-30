#!/usr/bin/env bash
# Install this file root-owned outside the repository. Never execute request content.
set -euo pipefail
ROOT=/opt/school-security
STATE=/var/lib/school-security-updater
exec 9>/run/school-security-update.lock
flock -n 9 || exit 0
[[ -f "$STATE/request" || -f "$STATE/auto-enabled" ]] || exit 0
if [[ -f "$STATE/failed" && ! -f "$STATE/request" ]]; then exit 0; fi
rm -f "$STATE/failed"
rm -f "$STATE/request"
status() {
    printf '{"status":"%s","message":"%s","updated_at":"%s"}\n' "$1" "$2" "$(date -u +%FT%TZ)" > "$STATE/status.tmp"
    chmod 644 "$STATE/status.tmp"
    mv "$STATE/status.tmp" "$STATE/status.json"
}
service_stopped=0
code_change_started=0
failed() {
    local exit_code=$?
    trap - ERR
    touch "$STATE/failed"
    # Only restart automatically while code/dependencies/schema are unchanged.
    # Once installation starts, restarting mixed versions is unsafe.
    if [[ "$service_stopped" == 1 && "$code_change_started" == 0 ]]; then
        if systemctl start school-security; then
            status failed "Pre-install check failed; original API restarted. Inspect updater journal before retrying."
        else
            status failed "Pre-install check failed; original API could not restart. Manual intervention required."
        fi
    else
        status failed "Update failed; inspect updater journal. Automatic rollback was not attempted."
    fi
    exit "$exit_code"
}
trap failed ERR
cd "$ROOT"
asapp() { runuser -u school-security -- "$@"; }
status checking "Checking main branch"
[[ -d .git ]]
[[ "$(asapp git remote get-url origin)" == "https://github.com/maisaak/School-Security-Analytics-System.git" ]]
[[ "$(asapp git branch --show-current)" == main ]]
[[ -z "$(asapp git status --porcelain --untracked-files=normal)" ]]
asapp git fetch --no-tags origin main
if [[ "$(asapp git rev-parse HEAD)" == "$(asapp git rev-parse FETCH_HEAD)" ]]; then
    status current "Already up to date"
    exit 0
fi
asapp git merge-base --is-ancestor HEAD FETCH_HEAD
status backup "Creating verified SQLite and media backup"
# This supported mode deliberately refuses non-default SQLite databases.
asapp .venv/bin/python -c 'import sys; sys.path.insert(0,"backend"); from app.core.config import settings,PROJECT_ROOT; assert settings.DATABASE_URL == "sqlite:///" + (PROJECT_ROOT / "school_security.db").as_posix(), "Updater supports default SQLite only"'
systemctl stop school-security
service_stopped=1
asapp .venv/bin/python scripts/backup_data.py
status installing "Installing dependencies and building frontend"
# Fast-forward only: no reset, clean or overwriting local modifications.
code_change_started=1
asapp git merge --ff-only FETCH_HEAD
asapp .venv/bin/python -m pip install -r backend/requirements.txt
asapp bash -c 'cd /opt/school-security/frontend && npm ci && npm run build'
asapp .venv/bin/python -m pytest backend/tests -q
cp -a frontend/dist/assets /var/www/school-security/
install -m 644 frontend/dist/index.html /var/www/school-security/index.html
chmod -R a+rX /var/www/school-security/assets
systemctl start school-security
for attempt in {1..60}; do
    if curl --fail --silent --max-time 3 http://127.0.0.1:8000/api/system/status >/dev/null; then
        status completed "Update installed; reload the page"
        exit 0
    fi
    sleep 2
done
false
