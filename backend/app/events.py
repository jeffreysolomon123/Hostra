"""Activity feed helpers: persist an event row and push it to the owner's live dashboard."""
from sqlalchemy.orm import Session

from . import bus, models


def notify(user_id: int, payload: dict):
    """Live-only message (not stored), e.g. 'deployment 12 is now building'."""
    bus.publish(f"user:{user_id}", payload)


def record(db: Session, app: models.App, type_: str, message: str):
    """Store an event AND push it live. Commits, so the row exists before clients refetch."""
    ev = models.Event(app_id=app.id, type=type_, message=message)
    db.add(ev)
    db.commit()
    notify(app.owner_id, {
        "type": "event",
        "app": app.name,
        "event": {"id": ev.id, "type": type_, "message": message,
                  "created_at": models.iso(ev.created_at)},
    })
    return ev
