"""Auto-recovery watcher: a reconciliation loop, like a tiny Kubernetes controller.

Every few seconds it compares DESIRED state (apps.desired_state in SQLite) with
ACTUAL state (Docker) and fixes the difference:

    desired=running, container exited/dead/unhealthy  ->  restart it
    desired=stopped                                   ->  leave it alone
    desired=failed                                    ->  leave it alone (crash loop)

Crash-loop protection: if an app needed more than MAX_RESTARTS restarts within
CRASH_WINDOW, restarting again is pointless (the code is broken), so we set
desired_state=failed and stop trying until the user presses Start or redeploys.
The restart history is simply the 'restart' rows in the events table.
"""
from datetime import timedelta

from sqlalchemy import func, select

from . import deployer, events, models
from .database import SessionLocal
from .locks import app_lock
from .models import now

INTERVAL = 5
CRASH_WINDOW = timedelta(minutes=5)
MAX_RESTARTS = 5

# Last status we saw per app id, to notice changes. In memory on purpose: after an
# API restart the first reading is just a baseline, not a "change".
_last_seen: dict[int, str] = {}


def _observed(container) -> str:
    if container is None:
        return "missing"
    if container.status == "running" and deployer.health_of(container) == "unhealthy":
        return "unhealthy"
    return container.status


def _restarts_in_window(db, app: models.App) -> int:
    """Restarts in the last 5 minutes, but only since the user last started/deployed
    the app, so pressing Start after a crash loop gives it a fresh budget."""
    last_reset = db.scalar(select(func.max(models.Event.created_at)).where(
        models.Event.app_id == app.id, models.Event.type.in_(("started", "deploy_live"))))
    since = now() - CRASH_WINDOW
    if last_reset is not None:
        since = max(since, last_reset)
    return db.scalar(select(func.count()).select_from(models.Event).where(
        models.Event.app_id == app.id, models.Event.type == "restart",
        models.Event.created_at >= since)) or 0


def _recover(db, app: models.App, slug: str):
    with app_lock(slug):
        # Re-read desired_state WHILE holding the lock. If the user pressed Stop after
        # our first reading, we see "stopped" here and do nothing (see locks.py).
        db.refresh(app)
        container = deployer.get_container(slug)
        state = _observed(container)
        if app.desired_state != "running" or container is None or state in ("running", "created"):
            return

        recent = _restarts_in_window(db, app)
        if recent >= MAX_RESTARTS:
            app.desired_state = "failed"
            db.commit()
            if state == "unhealthy":
                container.stop(timeout=5)
            events.record(db, app, "crash_loop",
                          f"Crash loop: {recent} restarts in {CRASH_WINDOW.seconds // 60} minutes. "
                          "Stopped retrying - fix the app and redeploy, or press Start.")
            return

        exit_code = container.attrs.get("State", {}).get("ExitCode")
        container.restart(timeout=5)
        app.restart_count += 1
        app.last_restart_at = now()
        db.commit()
        reason = "became unhealthy" if state == "unhealthy" else f"exited with code {exit_code}"
        events.record(db, app, "restart",
                      f"Container {reason}; restarted (attempt {recent + 1}/{MAX_RESTARTS})")


def check_once():
    deployer.connect_traefik_to_all_user_networks()
    containers = deployer.list_managed()
    db = SessionLocal()
    try:
        for app in db.scalars(select(models.App)).all():
            slug = deployer.make_slug(app.owner_id, app.name)
            state = _observed(containers.get(deployer.container_name(slug)))

            previous = _last_seen.get(app.id)
            _last_seen[app.id] = state
            if previous is not None and previous != state:
                events.notify(app.owner_id, {"type": "app_status", "app": app.name,
                                             "status": state})
                # Only unexpected changes go into the activity feed. A Stop by the user
                # already wrote its own "stopped" event.
                if app.desired_state == "running" and state not in ("running", "missing"):
                    events.record(db, app, "status", f"Container is now {state}")

            if app.desired_state == "running" and state in ("exited", "dead", "unhealthy"):
                try:
                    _recover(db, app, slug)
                except Exception as e:
                    print(f"[recovery] {slug}: {e}")
    finally:
        db.close()


def loop(stop_event):
    while not stop_event.is_set():
        try:
            check_once()
        except Exception as e:
            print(f"[recovery] error: {e}")
        stop_event.wait(INTERVAL)
