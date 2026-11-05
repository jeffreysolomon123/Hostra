from datetime import datetime, timezone

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def now():
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None  # always aware UTC (UTCDateTime)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(default=now)

    apps: Mapped[list["App"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )


class App(Base):
    __tablename__ = "apps"
    # the same name is allowed for different users, but not twice for one user
    __table_args__ = (UniqueConstraint("owner_id", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(32), index=True)
    repo_url: Mapped[str] = mapped_column(String(255))
    branch: Mapped[str | None] = mapped_column(String(100))  # None = repo default branch
    port: Mapped[int]                       # the port actually used (detected or override)
    port_override: Mapped[int | None]       # set only when the user typed a port
    host_port: Mapped[int | None]           # legacy column from v1, unused
    auto_deploy: Mapped[bool] = mapped_column(default=False)

    # Desired vs actual state: the DB says what SHOULD be true ("running"), Docker says
    # what IS true. The recovery watcher closes the gap. "failed" = gave up (crash loop).
    desired_state: Mapped[str] = mapped_column(String(16), default="running")
    restart_count: Mapped[int] = mapped_column(default=0)
    last_restart_at: Mapped[datetime | None]
    env_updated_at: Mapped[datetime | None]  # compared to the last deploy -> "redeploy to apply"

    created_at: Mapped[datetime] = mapped_column(default=now)
    updated_at: Mapped[datetime] = mapped_column(default=now, onupdate=now)

    owner: Mapped[User] = relationship(back_populates="apps")
    # delete-orphan: deleting an app deletes all of its rows below
    metrics: Mapped[list["Metric"]] = relationship(cascade="all, delete-orphan")
    events: Mapped[list["Event"]] = relationship(cascade="all, delete-orphan")
    deployments: Mapped[list["Deployment"]] = relationship(cascade="all, delete-orphan")
    env_vars: Mapped[list["EnvVar"]] = relationship(cascade="all, delete-orphan")


class Metric(Base):
    __tablename__ = "metrics"

    id: Mapped[int] = mapped_column(primary_key=True)
    app_id: Mapped[int] = mapped_column(ForeignKey("apps.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(default=now, index=True)
    cpu_percent: Mapped[float]
    mem_bytes: Mapped[int]
    net_rx: Mapped[int]  # total bytes received since the container started
    net_tx: Mapped[int]  # total bytes sent since the container started
    disk_bytes: Mapped[int | None]  # writable layer size, sampled only every 60s


class Event(Base):
    """Activity feed: restarts, status changes, deployments, settings changes."""
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    app_id: Mapped[int] = mapped_column(ForeignKey("apps.id"), index=True)
    type: Mapped[str] = mapped_column(String(32))
    message: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(default=now, index=True)


class Deployment(Base):
    __tablename__ = "deployments"

    id: Mapped[int] = mapped_column(primary_key=True)
    app_id: Mapped[int] = mapped_column(ForeignKey("apps.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued|building|live|failed
    trigger: Mapped[str] = mapped_column(String(16))                   # manual|webhook|redeploy
    commit_sha: Mapped[str | None] = mapped_column(String(40))
    commit_message: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(default=now)
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
    error: Mapped[str | None] = mapped_column(Text)


class EnvVar(Base):
    __tablename__ = "env_vars"
    __table_args__ = (UniqueConstraint("app_id", "key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    app_id: Mapped[int] = mapped_column(ForeignKey("apps.id"), index=True)
    key: Mapped[str] = mapped_column(String(64))
    value_encrypted: Mapped[str] = mapped_column(Text)  # Fernet token, never the plain value
    updated_at: Mapped[datetime] = mapped_column(default=now, onupdate=now)
