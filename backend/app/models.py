from datetime import datetime, timezone

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(default=_now)

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
    port: Mapped[int]
    host_port: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(default=_now)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)

    owner: Mapped[User] = relationship(back_populates="apps")