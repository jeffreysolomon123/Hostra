"""GitHub push webhooks -> automatic deployments.

Secret design: GITHUB_WEBHOOK_SECRET is a platform-wide master secret that is NEVER
shown to users. Each app gets its own webhook secret derived from it:

    app_secret = HMAC-SHA256(master, "app:<app_id>")

So every user sees only their own app's secret, nothing extra is stored, and a
leaked app secret cannot trigger deploys of other users' apps.

GitHub signs the raw request body: X-Hub-Signature-256: sha256=HMAC(app_secret, body).
We recompute it for each app that uses this repo + branch and deploy only the apps
whose signature matches. hmac.compare_digest compares in constant time, so an
attacker cannot learn the correct signature byte by byte from response timings.
"""
import hashlib
import hmac
import json

from sqlalchemy import select

from . import models, validation, worker
from .config import GITHUB_WEBHOOK_SECRET, PUBLIC_API_URL
from .database import SessionLocal

MAX_BODY = 5 * 1024 * 1024


class WebhookError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def app_secret(app_id: int) -> str:
    return hmac.new(GITHUB_WEBHOOK_SECRET.encode(), f"app:{app_id}".encode(),
                    hashlib.sha256).hexdigest()


def signature_ok(secret: str, body: bytes, header: str | None) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header or "")


def info_for(app: models.App) -> dict:
    return {
        "enabled": bool(GITHUB_WEBHOOK_SECRET),
        "url": f"{PUBLIC_API_URL}/webhooks/github",
        "secret": app_secret(app.id) if GITHUB_WEBHOOK_SECRET else None,
        "content_type": "application/json",
        "events": ["push"],
        "auto_deploy": app.auto_deploy,
        "branch": app.branch,
    }


def handle(event: str | None, signature: str | None, body: bytes) -> dict:
    """Blocking (DB). Called from the async endpoint through a threadpool."""
    if not GITHUB_WEBHOOK_SECRET:
        raise WebhookError(503, "Webhooks are disabled (GITHUB_WEBHOOK_SECRET not set)")
    if not signature:
        raise WebhookError(401, "Missing X-Hub-Signature-256")
    try:
        payload = json.loads(body)
        repo = payload["repository"]
        repo_url = validation.normalize_repo_url(repo.get("html_url") or repo["clone_url"])
    except (ValueError, KeyError, TypeError):
        raise WebhookError(400, "Not a GitHub repository event")

    db = SessionLocal()
    try:
        # Candidates: every app on this repo. The signature decides which ones are real.
        candidates = [a for a in db.scalars(select(models.App))
                      if validation.normalize_repo_url(a.repo_url) == repo_url]
        verified = [a for a in candidates if signature_ok(app_secret(a.id), body, signature)]
        if not verified:
            raise WebhookError(401, "Invalid signature")

        if event == "ping":
            return {"ok": True, "message": "pong", "apps": len(verified)}
        if event != "push":
            return {"ok": True, "message": f"Ignored event '{event}'"}

        ref = payload.get("ref", "")
        if not ref.startswith("refs/heads/"):
            return {"ok": True, "message": "Ignored: not a branch push"}
        branch = ref.removeprefix("refs/heads/")
        head = payload.get("head_commit") or {}

        queued = []
        for app in verified:
            if app.auto_deploy and (app.branch or branch) == branch:
                d = worker.enqueue(db, app, "webhook",
                                   commit_sha=(head.get("id") or "")[:40] or None,
                                   commit_message=(head.get("message") or "").split("\n")[0][:500] or None)
                queued.append(d.id)
        return {"ok": True, "queued": queued}
    finally:
        db.close()
