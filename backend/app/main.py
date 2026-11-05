import subprocess
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import docker
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from . import auth, collector, deployer, models
from .database import Base, engine, get_db

Base.metadata.create_all(bind=engine)

@asynccontextmanager
async def lifespan(_app):
    stop = threading.Event()
    threading.Thread(target=collector.loop, args=(stop,), daemon=True).start()
    yield
    stop.set()


app = FastAPI(title="Mini PaaS", lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------- schemas ----------

class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)


class DeployRequest(BaseModel):
    name: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,30}$")
    repo_url: str
    port: int = Field(default=5000, ge=1, le=65535)


# ---------- helpers ----------

def get_app_or_404(db: Session, user: models.User, name: str) -> models.App:
    """Only finds apps owned by this user. Someone else's app looks like it doesn't exist."""
    record = db.scalar(
        select(models.App).where(
            models.App.owner_id == user.id, models.App.name == name
        )
    )
    if record is None:
        raise HTTPException(404, f"App '{name}' not found")
    return record


# ---------- auth ----------

@app.post("/auth/signup", status_code=201)
def signup(req: SignupRequest, db: Session = Depends(get_db)):
    user = models.User(
        email=req.email.lower(),
        password_hash=auth.hash_password(req.password),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists")
    return {"id": user.id, "email": user.email}


@app.post("/auth/login")
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    # the form field is called "username", but we use it for the email
    user = db.scalar(
        select(models.User).where(models.User.email == form.username.lower())
    )
    if user is None or not auth.verify_password(form.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    return {"access_token": auth.create_access_token(user.id), "token_type": "bearer"}


@app.get("/auth/me")
def me(user: models.User = Depends(auth.get_current_user)):
    return {"id": user.id, "email": user.email}


# ---------- apps (all require login) ----------

@app.post("/deploy")
def deploy(
    req: DeployRequest,
    user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    if not req.repo_url.startswith("https://github.com/"):
        raise HTTPException(400, "Only https://github.com/ URLs are allowed")

    slug = deployer.make_slug(user.id, req.name)
    try:
        path = deployer.clone_repo(req.repo_url, slug)
        tag = deployer.build_image(path, slug)
        deployer.run_container(slug, user.id, req.name, tag, req.port)
    except subprocess.CalledProcessError as e:
        raise HTTPException(400, f"git clone failed: {e.stderr}")
    except FileNotFoundError as e:
        raise HTTPException(400, str(e))
    except docker.errors.BuildError as e:
        raise HTTPException(400, f"Docker build failed: {e}")
    except docker.errors.APIError as e:
        raise HTTPException(500, f"Docker error: {e}")

    record = db.scalar(
        select(models.App).where(
            models.App.owner_id == user.id, models.App.name == req.name
        )
    )
    if record is None:
        record = models.App(owner_id=user.id, name=req.name,
                            repo_url=req.repo_url, port=req.port)
        db.add(record)
    record.repo_url = req.repo_url
    record.port = req.port
    db.commit()
    return {"name": req.name, "url": deployer.app_url(user.id, req.name)}



@app.get("/apps")
def list_apps(
    user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(models.App).where(models.App.owner_id == user.id)
    ).all()
    return [
        {
            "name": r.name,
            "repo_url": r.repo_url,
            "port": r.port,
            "status": deployer.get_status(deployer.make_slug(user.id, r.name)),
            "url": deployer.app_url(user.id, r.name),
            "created_at": r.created_at,
        }
        for r in rows
    ]


@app.post("/apps/{name}/stop")
def stop_app(
    name: str,
    user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    get_app_or_404(db, user, name)
    slug = deployer.make_slug(user.id, name)
    try:
        deployer.stop_app(slug)
    except docker.errors.NotFound:
        raise HTTPException(404, "Container no longer exists, redeploy the app")
    return {"name": name, "status": deployer.get_status(slug)}


@app.post("/apps/{name}/start")
def start_app(
    name: str,
    user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    get_app_or_404(db, user, name)
    try:
        deployer.start_app(deployer.make_slug(user.id, name))
    except docker.errors.NotFound:
        raise HTTPException(404, "Container no longer exists, redeploy the app")
    return {"name": name, "url": deployer.app_url(user.id, name)}


@app.delete("/apps/{name}")
def delete_app(
    name: str,
    user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    record = get_app_or_404(db, user, name)
    deployer.delete_app(deployer.make_slug(user.id, name))
    db.delete(record)
    db.commit()
    return {"deleted": name}


@app.get("/apps/{name}/logs")
def app_logs(
    name: str,
    tail: int = 100,
    user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    get_app_or_404(db, user, name)
    try:
        slug = deployer.make_slug(user.id, name)
        return {"name": name, "logs": deployer.get_logs(slug, tail)}
    except docker.errors.NotFound:
        raise HTTPException(404, "Container no longer exists")


@app.get("/apps/{name}/metrics")
def app_metrics(
    name: str,
    minutes: int = 15,
    user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    record = get_app_or_404(db, user, name)
    since = datetime.now(timezone.utc) - timedelta(minutes=min(max(minutes, 1), 60))
    rows = db.scalars(
        select(models.Metric)
        .where(models.Metric.app_id == record.id, models.Metric.created_at >= since)
        .order_by(models.Metric.created_at)
    ).all()

    points, prev, prev_t = [], None, None
    for r in rows:
        t = int(r.created_at.replace(tzinfo=timezone.utc).timestamp())
        rx_rate = tx_rate = 0.0
        if prev is not None and t > prev_t:
            seconds = t - prev_t
            # max(...) guards against the counter resetting after a restart
            rx_rate = max(r.net_rx - prev.net_rx, 0) / seconds
            tx_rate = max(r.net_tx - prev.net_tx, 0) / seconds
        points.append({
            "t": t,
            "cpu_percent": r.cpu_percent,
            "mem_mb": round(r.mem_bytes / 1024 / 1024, 1),
            "rx_kbps": round(rx_rate / 1024, 2),
            "tx_kbps": round(tx_rate / 1024, 2),
        })
        prev, prev_t = r, t
    return points