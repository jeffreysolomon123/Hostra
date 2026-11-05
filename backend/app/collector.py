from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from . import deployer, models
from .database import SessionLocal

INTERVAL = 5                     # seconds between readings
RETENTION = timedelta(hours=1)   # older readings are deleted


def collect_once():
    db = SessionLocal()
    try:
        for container in deployer.list_running():
            try:
                owner_id = int(container.labels["paas.owner"])
                name = container.labels["paas.app"]
                stats = deployer.read_stats(container)
            except Exception:
                continue  # container vanished mid-read, skip it

            record = db.scalar(
                select(models.App).where(
                    models.App.owner_id == owner_id, models.App.name == name
                )
            )
            if record is not None:
                db.add(models.Metric(app_id=record.id, **stats))

        cutoff = datetime.now(timezone.utc) - RETENTION
        db.execute(delete(models.Metric).where(models.Metric.created_at < cutoff))
        db.commit()
    finally:
        db.close()


def loop(stop_event):
    while not stop_event.is_set():
        try:
            collect_once()
        except Exception as e:
            print(f"[collector] error: {e}")
        stop_event.wait(INTERVAL)