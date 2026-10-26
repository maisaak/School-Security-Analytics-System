"""Generate a local .env without overwriting an existing configuration."""
from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1]
target = root / ".env"
if target.exists():
    raise SystemExit(".env already exists; nothing changed.")
text = (root / ".env.example").read_text(encoding="utf-8")
text = text.replace("API_KEY=\n", f"API_KEY={secrets.token_urlsafe(36)}\n")
text = text.replace("POSTGRES_PASSWORD=\n", f"POSTGRES_PASSWORD={secrets.token_hex(24)}\n")
with target.open("x", encoding="utf-8") as file:
    file.write(text)
print(f"Created {target}. Use API_KEY from this file to sign in. Do not publish .env.")
