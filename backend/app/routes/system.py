from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import auth, deployer, models, webhooks
from ..database import get_db
from ..models import now

router = APIRouter(tags=["system"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/system/overview")
def overview(user: models.User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    """Header numbers for the dashboard: counts + current CPU/memory across the user's apps."""
    apps = db.scalars(select(models.App).where(models.App.owner_id == user.id)).all()
    containers = deployer.list_managed()
    running = [a for a in apps
               if (c := containers.get(deployer.container_name(deployer.make_slug(a.owner_id, a.name))))
               and c.status == "running"]

    # newest reading per running app, if it is fresh (collector runs every 5s)
    cpu = mem = 0.0
    fresh = now() - timedelta(seconds=20)
    for app in running:
        m = db.scalar(select(models.Metric).where(models.Metric.app_id == app.id,
                                                  models.Metric.created_at >= fresh)
                      .order_by(models.Metric.id.desc()).limit(1))
        if m:
            cpu += m.cpu_percent
            mem += m.mem_bytes
    deployments = db.scalar(select(func.count()).select_from(models.Deployment)
                            .join(models.App).where(models.App.owner_id == user.id)) or 0
    return {
        "apps": len(apps),
        "running": len(running),
        "cpu_percent": round(cpu, 2),
        "mem_mb": round(mem / 1024 / 1024, 1),
        "deployments": deployments,
    }


@router.post("/webhooks/github", tags=["webhooks"])
async def github_webhook(request: Request):
    """async because we need the RAW body bytes (the HMAC is over the exact bytes
    GitHub sent; re-serialized JSON would not match). The DB work is blocking, so
    it runs in the threadpool."""
    length = int(request.headers.get("content-length") or 0)
    if length > webhooks.MAX_BODY:
        raise HTTPException(413, "Payload too large")
    body = await request.body()
    try:
        return await run_in_threadpool(
            webhooks.handle,
            request.headers.get("x-github-event"),
            request.headers.get("x-hub-signature-256"),
            body,
        )
    except webhooks.WebhookError as e:
        raise HTTPException(e.status, str(e))
