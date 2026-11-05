from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import DateTime, TypeDecorator, create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DB_PATH = Path(__file__).resolve().parent.parent / "paas.db"

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    # Several background threads (collector, watcher, build workers) share this DB.
    # check_same_thread=False lets a connection cross threads; timeout makes a writer
    # wait up to 15s for a lock instead of failing with "database is locked".
    connect_args={"check_same_thread": False, "timeout": 15},
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    # WAL lets readers keep reading while one thread writes (the default mode blocks them).
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class UTCDateTime(TypeDecorator):
    """SQLite has no timezone support: it hands back naive datetimes, while our code
    creates aware ones (datetime.now(timezone.utc)). Mixing them crashes on
    subtraction/comparison. This type stores naive UTC and always returns aware UTC,
    so every datetime in the app is aware."""
    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        return value.replace(tzinfo=timezone.utc) if value is not None else None


class Base(DeclarativeBase):
    # every `Mapped[datetime]` column uses UTCDateTime
    type_annotation_map = {datetime: UTCDateTime}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# create_all() creates missing TABLES but never adds COLUMNS to tables that already
# exist. These are the columns added after the first release; each one is added with
# ALTER TABLE only if PRAGMA table_info says it is missing, so this is safe to run on
# every startup (idempotent) and an existing paas.db keeps working. No Alembic needed.
NEW_COLUMNS = {
    "apps": {
        "desired_state": "VARCHAR(16) NOT NULL DEFAULT 'running'",
        "restart_count": "INTEGER NOT NULL DEFAULT 0",
        "last_restart_at": "DATETIME",
        "branch": "VARCHAR(100)",
        "auto_deploy": "BOOLEAN NOT NULL DEFAULT 0",
        "port_override": "INTEGER",
        "env_updated_at": "DATETIME",
    },
    "metrics": {
        "disk_bytes": "INTEGER",
    },
}


def migrate():
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        for table, columns in NEW_COLUMNS.items():
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            for name, ddl in columns.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
