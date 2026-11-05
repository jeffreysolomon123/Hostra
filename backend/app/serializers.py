"""Turn DB rows into the JSON shapes the frontend uses. Kept in one place so the
REST endpoints and the WebSocket events always send identical objects."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import deployer, models
from .models import iso


def deployment(d: models.Deployment) -> dict:
    duration = None
    if d.started_at and d.finished_at:
        duration = round((d.finished_at - d.started_at).total_seconds(), 1)
    return {
        "id": d.id,
        "app_id": d.app_id,
        "status": d.status,
        "trigger": d.trigger,
        "commit_sha": d.commit_sha,
        "commit_message": d.commit_message,
        "created_at": iso(d.created_at),
        "started_at": iso(d.started_at),
        "finished_at": iso(d.finished_at),
        "duration_s": duration,
        "error": d.error,
    }


def event(e: models.Event) -> dict:
    return {"id": e.id, "type": e.type, "message": e.message, "created_at": iso(e.created_at)}


def display_status(app: models.App, container, latest: models.Deployment | None) -> str:
    """One word for the UI, combining desired state (DB) and actual state (Docker)."""
    building = latest is not None and latest.status in ("queued", "building")
    if container is None:
        if building:
            return "building"
        if latest is not None and latest.status == "failed":
            return "failed"
        return "missing"
    if app.desired_state == "failed":
        return "failed"                      # crash loop: the watcher gave up
    if container.status == "running":
        if deployer.health_of(container) == "unhealthy":
            return "unhealthy"
        return "running"
    if app.desired_state == "stopped":
        return "stopped"
    return "crashed"                          # should be running; the watcher will restart it


def app_summary(db: Session, app: models.App, containers: dict) -> dict:
    slug = deployer.make_slug(app.owner_id, app.name)
    container = containers.get(deployer.container_name(slug))
    latest = db.scalar(select(models.Deployment).where(models.Deployment.app_id == app.id)
                       .order_by(models.Deployment.id.desc()).limit(1))
    last_live = db.scalar(select(models.Deployment)
                          .where(models.Deployment.app_id == app.id,
                                 models.Deployment.status == "live")
                          .order_by(models.Deployment.id.desc()).limit(1))
    # env changed after the running container was created -> "redeploy to apply"
    needs_redeploy = bool(app.env_updated_at and last_live and last_live.finished_at
                          and app.env_updated_at > last_live.finished_at)
    return {
        "id": app.id,
        "name": app.name,
        "repo_url": app.repo_url,
        "branch": app.branch,
        "port": app.port,
        "port_override": app.port_override,
        "auto_deploy": app.auto_deploy,
        "status": display_status(app, container, latest),
        "container_status": container.status if container else "missing",
        "desired_state": app.desired_state,
        "restart_count": app.restart_count,
        "last_restart_at": iso(app.last_restart_at),
        "url": deployer.app_url(app.owner_id, app.name),
        "created_at": iso(app.created_at),
        "last_deployed_at": iso(last_live.finished_at) if last_live else None,
        "latest_deployment": deployment(latest) if latest else None,
        "needs_redeploy": needs_redeploy,
        "limits": deployer.LIMITS,
    }
