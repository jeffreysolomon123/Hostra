"""Metrics collector: every 5 seconds, one reading per running app container.

Why our own instead of Prometheus + cAdvisor: zero extra services on a laptop and
the whole data path fits in one file. At scale you would switch (see ARCHITECTURE.md).

container.stats(stream=False) takes ~1-2s per container (Docker waits for two CPU
samples), so containers are read in parallel; otherwise 5 apps would already
blow the 5-second budget.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from sqlalchemy import delete, select

from . import deployer, models
from .database import SessionLocal
from .models import now

INTERVAL = 5                     # seconds between readings
DISK_EVERY = 12                  # disk size every 12th reading = every 60s (it is slow)
RETENTION = timedelta(hours=1)   # older readings are deleted

_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="stats")
_tick = 0


def _read(container):
    try:
        return container, deployer.read_stats(container)
    except Exception:
        return container, None  # container vanished mid-read, skip it


def collect_once():
    global _tick
    disk = {}
    if _tick % DISK_EVERY == 0:
        try:
            disk = deployer.disk_usage_all()
        except Exception as e:
            print(f"[collector] disk usage failed: {e}")
    _tick += 1

    containers = deployer.list_running()
    results = list(_pool.map(_read, containers))
    for container, stats in results:
        if stats is not None:
            stats["disk_bytes"] = disk.get(container.id)

    db = SessionLocal()
    try:
        app_ids = {(a.owner_id, a.name): a.id for a in db.scalars(select(models.App))}
        for container, stats in results:
            if stats is None:
                continue
            key = (int(container.labels.get("paas.owner", 0)), container.labels.get("paas.app"))
            if key in app_ids:
                db.add(models.Metric(app_id=app_ids[key], **stats))

        db.execute(delete(models.Metric).where(models.Metric.created_at < now() - RETENTION))
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
