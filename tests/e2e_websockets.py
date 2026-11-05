"""End-to-end WebSocket test (run tests/e2e_api.py first: it creates the users and apps).
Run: cd backend && ./venv/bin/python ../tests/e2e_websockets.py"""
import asyncio
import json
import sys
import time

import docker
import requests
import websockets

API = "http://localhost:8000"
WS = "ws://localhost:8000"
dc = docker.from_env()
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def session(email):
    s = requests.Session()
    while True:  # e2e_api.py ends by tripping the login rate limit: wait it out
        r = s.post(f"{API}/auth/login", data={"username": email, "password": "testpass123"})
        if r.status_code != 429:
            break
        wait = int(r.headers.get("Retry-After", 5))
        print(f"login rate limited, waiting {wait}s", flush=True)
        time.sleep(wait)
    tok = r.json()["access_token"]
    s.headers["Authorization"] = f"Bearer {tok}"
    s.uid = s.get(f"{API}/auth/me").json()["id"]
    return s


def ticket(s):
    return s.post(f"{API}/auth/ws-ticket").json()["ticket"]


async def close_code(url):
    try:
        async with websockets.connect(url) as ws:
            while True:
                await asyncio.wait_for(ws.recv(), 5)
    except websockets.ConnectionClosed as e:
        return e.rcvd.code if e.rcvd else None
    except asyncio.TimeoutError:
        return "open"


async def collect(ws, pred, timeout):
    """Receive messages until pred(msg) is true; return all received messages."""
    got = []
    end = time.time() + timeout
    while time.time() < end:
        try:
            msg = json.loads(await asyncio.wait_for(ws.recv(), max(0.1, end - time.time())))
        except (asyncio.TimeoutError, websockets.ConnectionClosed):
            break
        got.append(msg)
        if pred(msg):
            break
    return got


async def main():
    alice, bob = session("alice@example.com"), session("bob@example.com")
    host = f"web-{alice.uid}.localhost"

    # --- ticket rules ---
    check("no ticket -> 4401", await close_code(f"{WS}/ws/events") == 4401)
    t = ticket(alice)
    async with websockets.connect(f"{WS}/ws/events?ticket={t}") as ws:
        hello = json.loads(await ws.recv())
    check("valid ticket -> hello", hello["type"] == "hello")
    check("reused ticket -> 4401", await close_code(f"{WS}/ws/events?ticket={t}") == 4401)
    check("ticket is not a login token",
          requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {ticket(alice)}"}).status_code == 401)
    check("garbage ticket -> 4401", await close_code(f"{WS}/ws/events?ticket=abc.def.ghi") == 4401)

    # --- ownership ---
    alice_dep = alice.get(f"{API}/apps/web/deployments").json()[0]["id"]
    check("bob -> alice's app logs: 4404", await close_code(f"{WS}/ws/apps/only-alice/logs?ticket={ticket(bob)}") == 4404)
    check("bob -> alice's build: 4404", await close_code(f"{WS}/ws/deployments/{alice_dep}/build?ticket={ticket(bob)}") == 4404)

    # --- events + build stream during a redeploy ---
    async with websockets.connect(f"{WS}/ws/events?ticket={ticket(alice)}") as ev:
        await ev.recv()  # hello
        dep = alice.post(f"{API}/apps/web/redeploy").json()["deployment_id"]
        async with websockets.connect(f"{WS}/ws/deployments/{dep}/build?ticket={ticket(alice)}") as b:
            msgs = await collect(b, lambda m: m["type"] == "deployment" and m["deployment"]["status"] in ("live", "failed"), 240)
            try:
                await asyncio.wait_for(b.recv(), 3)
                closed = None
            except websockets.ConnectionClosed as e:
                closed = e.rcvd.code if e.rcvd else None
        snap = msgs[0]
        live_lines = [m for m in msgs if m["type"] == "log"]
        ns = [m["n"] for m in live_lines]
        check("build ws snapshot first", snap["type"] == "snapshot")
        check("build ws streams lines live", len(live_lines) > 5, f"{len(live_lines)} live lines")
        check("no duplicate/out-of-order lines", ns == sorted(set(ns)) and (not ns or ns[0] > len(snap["lines"]) - 0))
        check("build ws final status live", msgs[-1].get("deployment", {}).get("status") == "live")
        check("build ws closes 1000 when done", closed == 1000, str(closed))
        evs = await collect(ev, lambda m: m.get("type") == "event" and m["event"]["type"] == "deploy_live", 10)
        types = [m["type"] for m in evs]
        check("events ws got deployment + deploy_live", "deployment" in types and any(
            m.get("type") == "event" and m["event"]["type"] == "deploy_live" for m in evs), ",".join(types))

    # --- finished build: snapshot + immediate close ---
    async with websockets.connect(f"{WS}/ws/deployments/{dep}/build?ticket={ticket(alice)}") as b:
        snap = json.loads(await b.recv())
    check("finished build -> full snapshot", snap["type"] == "snapshot" and any("Live at" in l for l in snap["lines"]))

    # --- runtime logs: tail, follow, survive a crash + auto restart ---
    async with websockets.connect(f"{WS}/ws/apps/web/logs?ticket={ticket(alice)}") as lg, \
               websockets.connect(f"{WS}/ws/events?ticket={ticket(alice)}") as ev:
        await ev.recv()
        first = await collect(lg, lambda m: m["type"] == "attached", 5)
        check("logs ws attached", any(m["type"] == "attached" for m in first))
        marker = f"/marker-{int(time.time())}"
        requests.get(f"http://localhost{marker}", headers={"Host": host}, timeout=5)
        got = await collect(lg, lambda m: m["type"] == "logs" and any(marker in l for l in m["lines"]), 10)
        check("live log line arrives", any(m["type"] == "logs" and any(marker in l for l in m["lines"]) for m in got))

        dc.containers.get(f"paas-{alice.uid}-web").kill()
        got = await collect(lg, lambda m: m["type"] == "attached", 30)
        types = [m["type"] for m in got]
        check("logs ws detaches and re-attaches after restart", "detached" in types and types[-1] == "attached", ",".join(types))
        evs = await collect(ev, lambda m: m.get("type") == "event" and m["event"]["type"] == "restart", 15)
        check("events ws: restart event pushed", any(m.get("type") == "event" and m["event"]["type"] == "restart" for m in evs),
              ",".join(m.get("type") for m in evs))
        marker2 = f"/after-restart-{int(time.time())}"
        time.sleep(1)
        requests.get(f"http://localhost{marker2}", headers={"Host": host}, timeout=5)
        got = await collect(lg, lambda m: m["type"] == "logs" and any(marker2 in l for l in m["lines"]), 10)
        check("logs flow again after restart", any(m["type"] == "logs" and any(marker2 in l for l in m["lines"]) for m in got))

    # --- connection churn: open/close many sockets, server stays healthy ---
    for _ in range(15):
        async with websockets.connect(f"{WS}/ws/apps/web/logs?ticket={ticket(alice)}") as lg:
            await asyncio.wait_for(lg.recv(), 5)
    await asyncio.sleep(3)
    check("server healthy after churn", requests.get(f"{API}/health", timeout=3).ok)

    # --- expiry ---
    t = ticket(alice)
    await asyncio.sleep(31)
    check("expired ticket -> 4401", await close_code(f"{WS}/ws/events?ticket={t}") == 4401)


asyncio.run(main())
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
