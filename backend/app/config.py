"""All configuration in one place, loaded from backend/.env (python-dotenv).

Every other module imports settings from here instead of calling os.environ,
so there is exactly one spot to look when asking "where does X come from?".
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
# Real environment variables win over .env (override=False), which is handy for tests.
load_dotenv(BACKEND_DIR / ".env", override=False)

SECRET_KEY = os.environ.get("PAAS_SECRET_KEY", "")
# Fail fast instead of silently running with a guessable key: this key signs every
# login token and derives the key that encrypts env vars at rest.
if len(SECRET_KEY.encode()) < 32:
    raise RuntimeError(
        "PAAS_SECRET_KEY must be set (backend/.env) and be at least 32 bytes. "
        "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
    )

DOMAIN = os.environ.get("DOMAIN", "localhost")
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")
GITHUB_WEBHOOK_SECRET = os.environ.get("GITHUB_WEBHOOK_SECRET", "")
# Public base URL of this API, only used to show users their webhook URL.
PUBLIC_API_URL = os.environ.get("PUBLIC_API_URL", "http://localhost:8000")
