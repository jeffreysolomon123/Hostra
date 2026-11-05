from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models


def get_app_or_404(db: Session, user: models.User, name: str) -> models.App:
    """Only finds apps owned by this user. Someone else's app looks like it doesn't
    exist (404, not 403), so you cannot probe which app names other users have."""
    record = db.scalar(
        select(models.App).where(models.App.owner_id == user.id, models.App.name == name)
    )
    if record is None:
        raise HTTPException(404, f"App '{name}' not found")
    return record


def get_deployment_or_404(db: Session, user: models.User, deployment_id: int):
    """Same rule for deployments: ownership is checked through the app."""
    row = db.execute(
        select(models.Deployment, models.App)
        .join(models.App, models.App.id == models.Deployment.app_id)
        .where(models.Deployment.id == deployment_id, models.App.owner_id == user.id)
    ).first()
    if row is None:
        raise HTTPException(404, "Deployment not found")
    return row[0], row[1]
