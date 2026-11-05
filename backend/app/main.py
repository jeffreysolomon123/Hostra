"""Hostra API entry point: wires routers together and starts the background threads.

Background threads (all daemon threads, all stopped through one Event):
  - collector : container metrics every 5s           (collector.py)
  - recovery  : desired vs actual state, restarts    (recovery.py)
  - build-N   : deployment workers                   (worker.py)
"""
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import collector, config, database, recovery, worker
from .routes import apps, auth_routes, env, system, ws


@asynccontextmanager
async def lifespan(_app):
    database.migrate()          # create tables + add new columns to an existing paas.db
    worker.fail_interrupted()   # builds cut off by the last shutdown can never finish
    stop = threading.Event()
    threading.Thread(target=collector.loop, args=(stop,), name="collector", daemon=True).start()
    threading.Thread(target=recovery.loop, args=(stop,), name="recovery", daemon=True).start()
    worker.start(stop)
    yield
    stop.set()


app = FastAPI(title="Hostra", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.FRONTEND_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router)
app.include_router(auth_routes.router)
app.include_router(apps.router)
app.include_router(env.router)
app.include_router(ws.router)
