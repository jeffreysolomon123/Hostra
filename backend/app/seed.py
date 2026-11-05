"""Demo data: python -m app.seed  (from backend/, or `make seed`)

Creates a demo user and deploys the three apps in samples/:
  hello-flask   Flask, EXPOSE 5000, uses the GREETING env var
  node-express  Express, EXPOSE 3000
  crashy        exits after 10s -> auto-restarts -> crash loop -> "failed"

Runs the normal build pipeline (worker.run_deployment) synchronously in this
process. The API process does not need to be stopped; its recovery watcher and
collector pick the containers up within a few seconds. Safe to run again.

The demo password comes from DEMO_PASSWORD (default below). It is a throwaway
local account, never a real credential.
"""
import os
import sys

from sqlalchemy import select

from . import auth, crypto, database, deployer, models, worker
from .database import SessionLocal

DEMO_EMAIL = os.environ.get("DEMO_EMAIL", "demo@example.com")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "hostra-demo")

SAMPLES = [
    {"name": "hello-flask", "dir": "hello-flask", "env": {"GREETING": "Hello"}},
    {"name": "node-express", "dir": "node-express", "env": {}},
    {"name": "crashy", "dir": "crashy", "env": {"CRASH_AFTER": "10"}},
]


def main():
    database.migrate()
    db = SessionLocal()
    try:
        user = db.scalar(select(models.User).where(models.User.email == DEMO_EMAIL))
        if user is None:
            user = models.User(email=DEMO_EMAIL, password_hash=auth.hash_password(DEMO_PASSWORD))
            db.add(user)
            db.commit()
            print(f"created user {DEMO_EMAIL}")
        else:
            print(f"user {DEMO_EMAIL} exists, reusing it")

        failed = 0
        for s in SAMPLES:
            app = db.scalar(select(models.App).where(models.App.owner_id == user.id,
                                                     models.App.name == s["name"]))
            if app is None:
                app = models.App(owner_id=user.id, name=s["name"], port=deployer.DEFAULT_PORT,
                                 repo_url=f"{deployer.LOCAL_PREFIX}samples/{s['dir']}")
                db.add(app)
                db.flush()
            for key, value in s["env"].items():
                existing = db.scalar(select(models.EnvVar).where(models.EnvVar.app_id == app.id,
                                                                 models.EnvVar.key == key))
                if existing is None:
                    db.add(models.EnvVar(app_id=app.id, key=key, value_encrypted=crypto.encrypt(value)))
            db.commit()

            d = worker.create_deployment(db, app, "manual")
            print(f"building {s['name']} (deployment #{d.id}) ...", flush=True)
            worker.run_deployment(d.id)  # blocking: clone/copy -> build -> run
            db.refresh(d)
            if d.status == "live":
                print(f"  live at {deployer.app_url(user.id, app.name)}")
            else:
                failed += 1
                print(f"  FAILED: {d.error}")
        print(f"\nLog in at the dashboard as {DEMO_EMAIL}. "
              "Watch 'crashy' restart and then stop at 'failed' within ~1-2 minutes.")
        return 1 if failed else 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
