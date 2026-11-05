"""Per-app environment variables. Values are encrypted at rest and masked in lists;
reading a plain value needs the explicit /reveal endpoint. Changing variables
does NOT redeploy; the app summary gets needs_redeploy=true instead."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import auth, crypto, events, models, validation
from ..database import get_db
from ..deps import get_app_or_404
from ..models import iso, now
from .apps import upsert_env, validate_env

router = APIRouter(prefix="/apps/{name}/env", tags=["env"])
Auth = Depends(auth.get_current_user)
MASK = "••••••••"


def _rows(db, app):
    return db.scalars(select(models.EnvVar).where(models.EnvVar.app_id == app.id)
                      .order_by(models.EnvVar.key)).all()


def _listing(db, app):
    return [{"key": r.key, "value": MASK, "updated_at": iso(r.updated_at)} for r in _rows(db, app)]


class EnvBody(BaseModel):
    vars: dict[str, str] = Field(default_factory=dict)


@router.get("")
def list_env(name: str, user: models.User = Auth, db: Session = Depends(get_db)):
    return _listing(db, get_app_or_404(db, user, name))


@router.put("")
def set_env(name: str, body: EnvBody, user: models.User = Auth, db: Session = Depends(get_db)):
    """Add or update one or many variables (the UI's single edit and bulk .env paste)."""
    app = get_app_or_404(db, user, name)
    try:
        env = validate_env(body.vars)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if len({r.key for r in _rows(db, app)} | set(env)) > validation.ENV_MAX_VARS:
        raise HTTPException(422, f"At most {validation.ENV_MAX_VARS} variables per app")
    upsert_env(db, app, env)
    db.commit()
    # Only the KEYS go into the activity feed, never values.
    events.record(db, app, "env_changed", "Environment updated: " + ", ".join(sorted(env)))
    return _listing(db, app)


@router.delete("/{key}")
def delete_env(name: str, key: str, user: models.User = Auth, db: Session = Depends(get_db)):
    app = get_app_or_404(db, user, name)
    row = db.scalar(select(models.EnvVar).where(models.EnvVar.app_id == app.id,
                                                models.EnvVar.key == key))
    if row is None:
        raise HTTPException(404, "Variable not found")
    db.delete(row)
    app.env_updated_at = now()
    db.commit()
    events.record(db, app, "env_changed", f"Environment variable removed: {key}")
    return _listing(db, app)


@router.get("/{key}/reveal")
def reveal_env(name: str, key: str, user: models.User = Auth, db: Session = Depends(get_db)):
    app = get_app_or_404(db, user, name)
    row = db.scalar(select(models.EnvVar).where(models.EnvVar.app_id == app.id,
                                                models.EnvVar.key == key))
    if row is None:
        raise HTTPException(404, "Variable not found")
    try:
        return {"key": key, "value": crypto.decrypt(row.value_encrypted)}
    except ValueError as e:
        raise HTTPException(500, str(e))
