#!/usr/bin/env bash
# Native Ubuntu/Debian deployment after prerequisites and .env configuration.
set -euo pipefail
ROOT="/opt/school-security"
DOMAIN="${1:-}"
[[ $EUID -eq 0 ]] || { echo "Run with sudo" >&2; exit 1; }
[[ "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || { echo "Usage: sudo bash scripts/deploy_server.sh school.example.org" >&2; exit 1; }
[[ -f "$ROOT/backend/requirements.txt" ]] || { echo "Clone project into $ROOT first" >&2; exit 1; }
id school-security >/dev/null 2>&1 || { echo "Create school-security user first; see README" >&2; exit 1; }
for tool in python3.13 node npm nginx curl runuser; do
    command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool; see README" >&2; exit 1; }
done
[[ "$(node -p 'Number(process.versions.node.split(".")[0]) >= 22')" == true ]] || { echo "Node.js 22+ required" >&2; exit 1; }
[[ -f "$ROOT/.env" ]] || { echo "Generate and configure $ROOT/.env first" >&2; exit 1; }
cd "$ROOT"
# Check configuration without loading ML dependencies or printing secrets.
runuser -u school-security -- python3.13 -c 'import sys; assert sys.version_info[:2] == (3, 13), "Python 3.13 required"'
runuser -u school-security -- python3.13 -m venv .venv
runuser -u school-security -- .venv/bin/python -m pip install --upgrade pip
runuser -u school-security -- .venv/bin/python -m pip install -r backend/requirements.txt
runuser -u school-security -- .venv/bin/python -c 'from sys import path; path.insert(0,"backend"); from app.core.config import settings; assert not settings.DEV_MODE, "Disable DEV_MODE"; assert len(settings.API_KEY) >= 32, "Configure API_KEY"; assert "*" not in settings.CORS_ORIGINS, "Restrict CORS_ORIGINS"'
runuser -u school-security -- bash -c 'cd /opt/school-security/frontend && npm ci && npm run build'
install -d -o root -g root -m 755 /var/www/school-security
# Copy assets first, index last; never remove unrelated files from the web root.
cp -a frontend/dist/assets /var/www/school-security/
install -m 644 frontend/dist/index.html /var/www/school-security/index.html
chmod -R a+rX /var/www/school-security
install -m 644 deploy/school-security.service /etc/systemd/system/school-security.service
sed "s/school.example.org/$DOMAIN/g" deploy/nginx.conf > /etc/nginx/sites-available/school-security
ln -sfn /etc/nginx/sites-available/school-security /etc/nginx/sites-enabled/school-security
nginx -t
systemctl daemon-reload
systemctl enable school-security nginx
systemctl restart school-security
ready=false
for attempt in {1..60}; do
    if curl --fail --silent http://127.0.0.1:8000/api/system/status >/dev/null; then ready=true; break; fi
    sleep 2
done
if [[ "$ready" != true ]]; then
    echo "API is not ready; inspect: journalctl -u school-security -n 100" >&2
    exit 1
fi
systemctl reload nginx
echo "HTTP configuration installed for $DOMAIN. Configure TLS with certbot before real use."
echo "Logs: journalctl -u school-security -f"
