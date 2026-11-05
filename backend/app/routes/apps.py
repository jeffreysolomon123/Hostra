"""App + deployment endpoints.

Most handlers are plain `def` (not `async def`) on purpose: they call Docker, which
blocks. FastAPI runs sync handlers in a threadpool, so the event loop stays free.
"""
from datetime import timedelta

import docker
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import (auth, crypto, deployer, events, models, ratelimit, serializers, validation,
               webhooks, worker)
from ..database import get_db
from ..deps import get_app_or_404, get_deployment_or_404
from ..locks import app_lock
from ..models import now

router = APIRouter(tags=["apps"])

Auth = Depends(auth.get_current_user)


class DeployRequest(BaseModel):
    name: str
    repo_url: str
    branch: str | None = None                       # None = the repo's default branch
    port: int | None = Field(default=None, ge=1, le=65535)  # None = auto-detect from EXPOSE
    auto_deploy: bool = False
    env: dict[str, str] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        if not validation.APP_NAME_RE.match(v):
            raise ValueError("2-31 chars: lowercase letters, digits and single hyphens, "
                             "starting and ending with a letter or digit")
        return v

    @field_validator("repo_url")
    @classmethod
    def _repo(cls, v):
        if validation.parse_repo_url(v) is None:
            raise ValueError("Must look like https://github.com/<owner>/<repo>")
        return v.strip().rstrip("/")

    @field_validator("branch")
    @classmethod
    def _branch(cls, v):
        if v in (None, ""):
            return None
        if not validation.valid_branch(v):
            raise ValueError("Invalid branch name")
        return v

    @field_validator("env")
    @classmethod
    def _env(cls, v):
        return validate_env(v)


def validate_env(env: dict[str, str]) -> dict[str, str]:
    if len(env) > validation.ENV_MAX_VARS:
        raise ValueError(f"At most {validation.ENV_MAX_VARS} variables")
    for key, value in env.items():
        if not validation.ENV_KEY_RE.match(key):
            raise ValueError(f"Invalid variable name: {key[:64]}")
        if len(value) > validation.ENV_VALUE_MAX:
            raise ValueError(f"Value of {key} is too long")
    return env


def upsert_env(db: Session, app: models.App, env: dict[str, str]):
    existing = {r.key: r for r in db.scalars(select(models.EnvVar).where(models.EnvVar.app_id == app.id))}
    for key, value in env.items():
        if key in existing:
            existing[key].value_encrypted = crypto.encrypt(value)
            existing[key].updated_at = now()
        else:
            db.add(models.EnvVar(app_id=app.id, key=key, value_encrypted=crypto.encrypt(value)))
    if env:
        app.env_updated_at = now()


# ---------- deploy ----------

@router.post("/deploy", status_code=202)
def deploy(req: DeployRequest, user: models.User = Auth, db: Session = Depends(get_db)):
    """Returns immediately with a deployment id; the build runs in a worker thread."""
    ratelimit.check("deploy", str(user.id), limit=10, window=60)
    record = db.scalar(select(models.App).where(models.App.owner_id == user.id,
                                                models.App.name == req.name))
    if record is None:
        record = models.App(owner_id=user.id, name=req.name, repo_url=req.repo_url,
                            port=req.port or deployer.DEFAULT_PORT)
        db.add(record)
    record.repo_url = req.repo_url
    record.branch = req.branch
    record.port_override = req.port
    record.auto_deploy = req.auto_deploy
    db.flush()  # assigns record.id for the env rows
    upsert_env(db, record, req.env)
    db.commit()  # commit BEFORE handing the id to the worker thread (it uses its own session)
    d = worker.enqueue(db, record, "manual")
    return {"name": record.name, "url": deployer.app_url(user.id, record.name),
            "deployment_id": d.id, "status": d.status}


@router.post("/apps/{name}/redeploy", status_code=202)
def redeploy(name: str, user: models.User = Auth, db: Session = Depends(get_db)):
    record = get_app_or_404(db, user, name)
    ratelimit.check("deploy", str(user.id), limit=10, window=60)
    d = worker.enqueue(db, record, "redeploy")
    return {"name": name, "deployment_id": d.id, "status": d.status}


# ---------- apps ----------

@router.get("/apps")
def list_apps(user: models.User = Auth, db: Session = Depends(get_db)):
    containers = deployer.list_managed()
    rows = db.scalars(select(models.App).where(models.App.owner_id == user.id)
                      .order_by(models.App.created_at.desc())).all()
    return [serializers.app_summary(db, r, containers) for r in rows]


@router.get("/apps/{name}")
def get_app(name: str, user: models.User = Auth, db: Session = Depends(get_db)):
    record = get_app_or_404(db, user, name)
    return serializers.app_summary(db, record, deployer.list_managed())


class AppSettings(BaseModel):
    branch: str | None = None
    auto_deploy: bool | None = None
    port: int | None = Field(default=None, ge=1, le=65535)


@router.patch("/apps/{name}")
def update_app(name: str, req: AppSettings, user: models.User = Auth,
               db: Session = Depends(get_db)):
    """Partial update. Only fields present in the JSON body change ("port": null
    clears the override and goes back to auto-detect). Applies on the next deploy."""
    record = get_app_or_404(db, user, name)
    sent = req.model_fields_set
    if "branch" in sent:
        if req.branch and not validation.valid_branch(req.branch):
            raise HTTPException(422, "Invalid branch name")
        record.branch = req.branch or None
    if "auto_deploy" in sent and req.auto_deploy is not None:
        record.auto_deploy = req.auto_deploy
    if "port" in sent:
        record.port_override = req.port
    db.commit()
    events.record(db, record, "settings", "Settings updated: " + ", ".join(sorted(sent)))
    return serializers.app_summary(db, record, deployer.list_managed())


@router.post("/apps/{name}/stop")
def stop_app(name: str, user: models.User = Auth, db: Session = Depends(get_db)):
    record = get_app_or_404(db, user, name)
    slug = deployer.make_slug(user.id, name)
    with app_lock(slug):
        # desired_state FIRST, then the container: the watcher can never see
        # "exited + desired running" and restart what the user just stopped.
        record.desired_state = "stopped"
        db.commit()
        try:
            deployer.stop_app(slug)
        except docker.errors.NotFound:
            raise HTTPException(404, "Container no longer exists, redeploy the app")
    events.record(db, record, "stopped", "Stopped by user")
    return serializers.app_summary(db, record, deployer.list_managed())


@router.post("/apps/{name}/start")
def start_app(name: str, user: models.User = Auth, db: Session = Depends(get_db)):
    record = get_app_or_404(db, user, name)
    slug = deployer.make_slug(user.id, name)
    with app_lock(slug):
        record.desired_state = "running"  # also clears "failed" after a crash loop
        db.commit()
        try:
            deployer.start_app(slug)
        except docker.errors.NotFound:
            raise HTTPException(404, "Container no longer exists, redeploy the app")
    events.record(db, record, "started", "Started by user")
    return serializers.app_summary(db, record, deployer.list_managed())


@router.delete("/apps/{name}")
def delete_app(name: str, user: models.User = Auth, db: Session = Depends(get_db)):
    record = get_app_or_404(db, user, name)
    slug = deployer.make_slug(user.id, name)
    deployment_ids = [d.id for d in record.deployments]
    with app_lock(slug):
        deployer.delete_app(slug)
        db.delete(record)  # cascades to metrics, events, deployments, env vars
        db.commit()
    for d_id in deployment_ids:
        worker.log_path(d_id).unlink(missing_ok=True)
    events.notify(user.id, {"type": "app_deleted", "app": name})
    return {"deleted": name}


@router.get("/apps/{name}/logs")
def app_logs(name: str, tail: int = 100, user: models.User = Auth, db: Session = Depends(get_db)):
    get_app_or_404(db, user, name)
    try:
        return {"name": name, "logs": deployer.get_logs(deployer.make_slug(user.id, name),
                                                       min(max(tail, 1), 5000))}
    except docker.errors.NotFound:
        raise HTTPException(404, "Container no longer exists")


@router.get("/apps/{name}/events")
def app_events(name: str, limit: int = 50, user: models.User = Auth,
               db: Session = Depends(get_db)):
    record = get_app_or_404(db, user, name)
    rows = db.scalars(select(models.Event).where(models.Event.app_id == record.id)
                      .order_by(models.Event.id.desc()).limit(min(max(limit, 1), 200)))
    return [serializers.event(e) for e in rows]


@router.get("/apps/{name}/metrics")
def app_metrics(name: str, minutes: int = 15, user: models.User = Auth,
                db: Session = Depends(get_db)):
    record = get_app_or_404(db, user, name)
    since = now() - timedelta(minutes=min(max(minutes, 1), 60))
    rows = db.scalars(
        select(models.Metric)
        .where(models.Metric.app_id == record.id, models.Metric.created_at >= since)
        .order_by(models.Metric.created_at)
    ).all()

    points, prev, prev_t, disk = [], None, None, None
    for r in rows:
        t = r.created_at.timestamp()
        rx_rate = tx_rate = 0.0
        # The DB stores running TOTALS; a chart wants a RATE: (difference) / (seconds).
        if prev is not None and t > prev_t:
            seconds = t - prev_t
            # A restarted container starts counting from 0 again. That makes the
            # difference negative, so clamp it to 0 instead of drawing a huge dip.
            rx_rate = max(r.net_rx - prev.net_rx, 0) / seconds
            tx_rate = max(r.net_tx - prev.net_tx, 0) / seconds
        if r.disk_bytes is not None:
            disk = r.disk_bytes  # sampled every 60s; carry the last value forward
        points.append({
            "t": int(t),
            "cpu_percent": r.cpu_percent,
            "mem_mb": round(r.mem_bytes / 1024 / 1024, 1),
            "rx_kbps": round(rx_rate / 1024, 2),
            "tx_kbps": round(tx_rate / 1024, 2),
            "disk_mb": round(disk / 1024 / 1024, 2) if disk is not None else None,
        })
        prev, prev_t = r, t
    return points


# ---------- deployments ----------

@router.get("/apps/{name}/deployments")
def list_deployments(name: str, user: models.User = Auth, db: Session = Depends(get_db)):
    record = get_app_or_404(db, user, name)
    rows = db.scalars(select(models.Deployment).where(models.Deployment.app_id == record.id)
                      .order_by(models.Deployment.id.desc()).limit(50))
    return [serializers.deployment(d) for d in rows]


@router.get("/deployments/{deployment_id}")
def get_deployment(deployment_id: int, user: models.User = Auth, db: Session = Depends(get_db)):
    d, app = get_deployment_or_404(db, user, deployment_id)
    return {**serializers.deployment(d), "app": app.name, "log": worker.read_log(d.id)[0]}


@router.get("/apps/{name}/webhook")
def webhook_info(name: str, user: models.User = Auth, db: Session = Depends(get_db)):
    record = get_app_or_404(db, user, name)
    return webhooks.info_for(record)
