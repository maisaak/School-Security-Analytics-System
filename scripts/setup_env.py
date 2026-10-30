"""Generate a local .env without overwriting an existing configuration."""
from pathlib import Path
import os
import secrets

root = Path(__file__).resolve().parents[1]
target = root / ".env"
if target.exists():
    raise SystemExit(".env already exists; nothing changed.")
text = (root / ".env.example").read_text(encoding="utf-8")
text = text.replace("API_KEY=\n", f"API_KEY={secrets.token_urlsafe(36)}\n")
text = text.replace("BOOTSTRAP_ADMIN_PASSWORD=\n", f"BOOTSTRAP_ADMIN_PASSWORD={secrets.token_urlsafe(24)}\n")
text = text.replace("POSTGRES_PASSWORD=\n", f"POSTGRES_PASSWORD={secrets.token_hex(24)}\n")
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as file:
    file.write(text)
print(f"Created {target}. First startup creates the administrator configured by BOOTSTRAP_ADMIN_USERNAME/PASSWORD. Read credentials locally from .env; do not publish it. API_KEY remains available for administrative access.")
