"""Deployment pipeline: POST /deploy only inserts a 'queued' row and puts its id on
a queue. A fixed pool of worker threads does the slow part (clone, build, run).

    API request --> Deployment(queued) --> queue.Queue --> worker thread
                                                             |  clone -> build -> run
                                                             v
                                         Deployment(live | failed) + build log file

MAX_CONCURRENT_BUILDS caps how many docker builds run at once (they are CPU and
disk heavy). Build output goes to logs/deployments/<id>.log and, live, to the bus.
"""
import queue
import threading
import traceback

from sqlalchemy import select

from . import bus, crypto, deployer, events, models, serializers
from .config import BACKEND_DIR
from .database import SessionLocal
from .locks import app_lock, build_lock
from .models import now

MAX_CONCURRENT_BUILDS = 2
LOG_DIR = BACKEND_DIR / "logs" / "deployments"
LOG_DIR.mkdir(parents=True, exist_ok=True)

_queue: "queue.Queue[int]" = queue.Queue()


def log_path(deployment_id: int):
    return LOG_DIR / f"{deployment_id}.log"


def read_log(deployment_id: int, max_lines: int = 5000) -> tuple[list[str], int]:
    """(last max_lines lines, total line count). The total is what the build WebSocket
    compares with the live line numbers to skip lines it already sent."""
    path = log_path(deployment_id)
    if not path.exists():
        return [], 0
    lines = path.read_text(errors="replace").splitlines()
    return lines[-max_lines:], len(lines)


def publish_status(app: models.App, d: models.Deployment):
    payload = {"type": "deployment", "app": app.name, "deployment": serializers.deployment(d)}
    bus.publish(f"build:{d.id}", payload)       # the build log page
    events.notify(app.owner_id, payload)        # the dashboard


def enqueue(db, app: models.App, trigger: str, commit_sha=None, commit_message=None):
    d = models.Deployment(app_id=app.id, status="queued", trigger=trigger,
                          commit_sha=commit_sha, commit_message=commit_message)
    db.add(d)
    db.commit()
    events.record(db, app, "deploy_queued", f"Deployment #{d.id} queued ({trigger})")
    publish_status(app, d)
    _queue.put(d.id)
    return d


def fail_interrupted():
    """At startup: anything still queued/building was cut off by a restart of the API."""
    db = SessionLocal()
    try:
        for d in db.scalars(select(models.Deployment)
                            .where(models.Deployment.status.in_(("queued", "building")))):
            d.status, d.error, d.finished_at = "failed", "Interrupted by a server restart", now()
        db.commit()
    finally:
        db.close()


def _env_for(db, app: models.App) -> dict[str, str]:
    rows = db.scalars(select(models.EnvVar).where(models.EnvVar.app_id == app.id))
    return {r.key: crypto.decrypt(r.value_encrypted) for r in rows}


def run_deployment(deployment_id: int):
    db = SessionLocal()
    logf = None
    try:
        d = db.get(models.Deployment, deployment_id)
        app = db.get(models.App, d.app_id) if d else None
        if app is None:
            return
        slug = deployer.make_slug(app.owner_id, app.name)
        logf = open(log_path(d.id), "a", encoding="utf-8")
        counter = 0

        def line(text: str):
            # n = line number, so a WebSocket that already read the file can skip duplicates
            nonlocal counter
            counter += 1
            logf.write(text + "\n")
            logf.flush()
            bus.publish(f"build:{d.id}", {"type": "log", "n": counter, "line": text})

        with build_lock(slug):  # one build per app at a time
            d.status, d.started_at = "building", now()
            db.commit()
            publish_status(app, d)
            try:
                line(f"==> Cloning {app.repo_url} ({app.branch or 'default branch'})")
                path = deployer.clone_repo(app.repo_url, slug, app.branch)
                sha, subject, branch = deployer.commit_info(path)
                d.commit_sha, d.commit_message = sha, subject
                app.branch = app.branch or branch
                db.commit()
                line(f"==> Commit {sha[:7]} on {branch}: {subject}")

                port = app.port_override or deployer.detect_port(path)
                source = ("set by you" if app.port_override else
                          "from Dockerfile EXPOSE" if port != deployer.DEFAULT_PORT else "default")
                line(f"==> Container port {port} ({source})")

                line("==> Building image")
                deployer.build_image(path, slug, line)

                line("==> Starting new container (old one keeps serving until it is healthy)")
                with app_lock(slug):
                    db.expire_all()
                    if db.get(models.App, app.id) is None:
                        line("==> App was deleted during the build, stopping")
                        deployer.delete_app(slug)
                        return
                    deployer.run_container(slug, app.owner_id, app.name, port,
                                           _env_for(db, app), d.id)
                    app.port = port
                    app.desired_state = "running"
                    app.restart_count = 0
                    d.status, d.finished_at = "live", now()
                    db.commit()
                line(f"==> Live at {deployer.app_url(app.owner_id, app.name)}")
                events.record(db, app, "deploy_live",
                              f"Deployment #{d.id} is live ({sha[:7]})")
            except deployer.DeployError as e:
                _fail(db, app, d, str(e), line)
            except Exception as e:  # unexpected: keep the message short, details in the server log
                traceback.print_exc()
                _fail(db, app, d, f"Internal error: {type(e).__name__}: {e}", line)
            publish_status(app, d)
    finally:
        if logf:
            logf.close()
        db.close()


def _fail(db, app, d, message: str, line):
    line(f"==> ERROR: {message}")
    line("==> Deployment failed. The previous version (if any) is still running.")
    d.status, d.error, d.finished_at = "failed", message[:4000], now()
    db.commit()
    events.record(db, app, "deploy_failed", f"Deployment #{d.id} failed: {message.splitlines()[0][:200]}")


def _worker(stop: threading.Event):
    while not stop.is_set():
        try:
            deployment_id = _queue.get(timeout=1)
        except queue.Empty:
            continue
        try:
            run_deployment(deployment_id)
        except Exception:
            traceback.print_exc()


def start(stop: threading.Event):
    for i in range(MAX_CONCURRENT_BUILDS):
        threading.Thread(target=_worker, args=(stop,), name=f"build-{i}", daemon=True).start()
