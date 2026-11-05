"""Authenticated WebSockets.

Connect with ?ticket=<from POST /auth/ws-ticket>. Close codes the client understands:
    4401  ticket missing/invalid/expired/used -> get a new ticket and reconnect
    4404  app/deployment not found or not yours (same rule as HTTP 404)
    1000  normal end (e.g. a finished build) -> do not reconnect

Rules followed in every handler:
  - Database and Docker calls block, so they run in the threadpool / a thread,
    never directly on the event loop.
  - While streaming we also wait for the client to disconnect, then clean up
    (unsubscribe, close the Docker stream, stop the reader thread).
"""
import asyncio
import threading
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from .. import auth, bus, deployer, models, serializers, worker
from ..database import SessionLocal

router = APIRouter()

CLOSE_UNAUTHORIZED = 4401
CLOSE_NOT_FOUND = 4404
HEARTBEAT = 25  # seconds; a ping keeps idle connections (and proxies) alive


async def _authenticate(ws: WebSocket, ticket: str | None) -> int | None:
    # Accept first, then close with a custom code: a rejected handshake only shows up
    # as a generic error in the browser, a close code tells the client what to do.
    await ws.accept()
    user_id = auth.consume_ws_ticket(ticket)
    if user_id is None:
        await ws.close(code=CLOSE_UNAUTHORIZED, reason="Invalid or expired ticket")
    return user_id


def _find_app(user_id: int, name: str) -> str | None:
    """Slug of the app if this user owns it (blocking DB call)."""
    db = SessionLocal()
    try:
        app = db.scalar(select(models.App).where(models.App.owner_id == user_id,
                                                 models.App.name == name))
        return deployer.make_slug(app.owner_id, app.name) if app else None
    finally:
        db.close()


def _find_deployment(user_id: int, deployment_id: int) -> dict | None:
    db = SessionLocal()
    try:
        row = db.execute(select(models.Deployment, models.App)
                         .join(models.App, models.App.id == models.Deployment.app_id)
                         .where(models.Deployment.id == deployment_id,
                                models.App.owner_id == user_id)).first()
        return {**serializers.deployment(row[0]), "app": row[1].name} if row else None
    finally:
        db.close()


async def _until_disconnect(ws: WebSocket, sender):
    """Run the sender coroutine and, in parallel, read from the socket only to notice
    when the client goes away. Whichever finishes first cancels the other."""
    async def receiver():
        try:
            while True:
                await ws.receive_text()
        except (WebSocketDisconnect, RuntimeError):
            pass

    tasks = [asyncio.create_task(sender), asyncio.create_task(receiver())]
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for t in pending:
        t.cancel()
    for t in done:
        if not t.cancelled() and t.exception() and \
                not isinstance(t.exception(), (WebSocketDisconnect, RuntimeError)):
            raise t.exception()


async def _next(q: asyncio.Queue) -> dict:
    try:
        return await asyncio.wait_for(q.get(), HEARTBEAT)
    except asyncio.TimeoutError:
        return {"type": "ping"}


# ---------- runtime logs ----------

@router.websocket("/ws/apps/{name}/logs")
async def ws_app_logs(ws: WebSocket, name: str, ticket: str | None = None):
    user_id = await _authenticate(ws, ticket)
    if user_id is None:
        return
    slug = await run_in_threadpool(_find_app, user_id, name)
    if slug is None:
        await ws.close(code=CLOSE_NOT_FOUND, reason="App not found")
        return

    loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue(maxsize=5000)
    stop = threading.Event()
    current = {"stream": None}

    def push(msg):
        def put():
            if not q.full():
                q.put_nowait(msg)
        loop.call_soon_threadsafe(put)

    def reader():
        """Plain thread: Docker's log stream is a blocking iterator.
        First attach: last 200 lines + follow. When the container stops (crash,
        restart by the watcher, redeploy swap) the stream ends; we wait for it to
        run again and re-attach with since=<when we lost it>, so no lines are lost."""
        since = None
        while not stop.is_set():
            try:
                c = deployer.get_container(slug)
                if c is None or (since is not None and c.status != "running"):
                    stop.wait(2)
                    continue
                kwargs = {"tail": 200} if since is None else {"since": since}
                stream = c.logs(stream=True, follow=True, **kwargs)
                current["stream"] = stream
                push({"type": "attached", "status": c.status})
                buf = b""
                for chunk in stream:
                    buf += chunk
                    *lines, buf = buf.split(b"\n")
                    if lines:
                        push({"type": "logs",
                              "lines": [ln.decode("utf-8", errors="replace") for ln in lines]})
                if buf:
                    push({"type": "logs", "lines": [buf.decode("utf-8", errors="replace")]})
                since = int(time.time())
                if not stop.is_set():
                    push({"type": "detached",
                          "message": "Container stopped, waiting for it to run again"})
            except Exception:
                if since is None:
                    since = int(time.time())
            stop.wait(2)

    threading.Thread(target=reader, name=f"logs-{slug}", daemon=True).start()

    async def sender():
        while True:
            await ws.send_json(await _next(q))

    try:
        await _until_disconnect(ws, sender())
    finally:
        stop.set()
        if current["stream"] is not None:
            # closing the HTTP stream makes the blocking iterator in reader() return
            await run_in_threadpool(current["stream"].close)


# ---------- build log ----------

@router.websocket("/ws/deployments/{deployment_id}/build")
async def ws_build_log(ws: WebSocket, deployment_id: int, ticket: str | None = None):
    user_id = await _authenticate(ws, ticket)
    if user_id is None:
        return
    if await run_in_threadpool(_find_deployment, user_id, deployment_id) is None:
        await ws.close(code=CLOSE_NOT_FOUND, reason="Deployment not found")
        return

    # Subscribe BEFORE reading the file: a line written in between is then both in the
    # file and in the queue, and the line number (n) lets us drop the duplicate.
    # Reading first could lose lines written between the read and the subscribe.
    q = bus.subscribe(f"build:{deployment_id}")
    try:
        lines, total = await run_in_threadpool(worker.read_log, deployment_id)
        d = await run_in_threadpool(_find_deployment, user_id, deployment_id)
        await ws.send_json({"type": "snapshot", "lines": lines, "deployment": d})
        if d["status"] in ("live", "failed"):
            await ws.close(code=1000)
            return

        async def sender():
            while True:
                msg = await _next(q)
                if msg["type"] == "log" and msg["n"] <= total:
                    continue
                await ws.send_json(msg)
                if msg["type"] == "deployment" and msg["deployment"]["status"] in ("live", "failed"):
                    await ws.close(code=1000)
                    return

        await _until_disconnect(ws, sender())
    finally:
        bus.unsubscribe(f"build:{deployment_id}", q)


# ---------- per-user dashboard events ----------

@router.websocket("/ws/events")
async def ws_events(ws: WebSocket, ticket: str | None = None):
    """App status changes, deployment status, restarts... for the logged-in user only
    (the topic is chosen from the ticket's user id, never from client input)."""
    user_id = await _authenticate(ws, ticket)
    if user_id is None:
        return
    q = bus.subscribe(f"user:{user_id}")
    try:
        await ws.send_json({"type": "hello"})

        async def sender():
            while True:
                await ws.send_json(await _next(q))

        await _until_disconnect(ws, sender())
    finally:
        bus.unsubscribe(f"user:{user_id}", q)
