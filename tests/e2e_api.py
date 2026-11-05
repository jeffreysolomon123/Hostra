"""End-to-end API test against the running stack (API :8000, Traefik :80, Docker).
Creates/uses alice@example.com and bob@example.com. Run: cd backend && ./venv/bin/python ../tests/e2e_api.py"""
import hashlib
import hmac
import json
import sqlite3
import sys
import time

import docker
import requests

API = "http://localhost:8000"
REPO = "https://github.com/jeffreysolomon123/hello-flask"
dc = docker.from_env()
results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def user(email):
    requests.post(f"{API}/auth/signup", json={"email": email, "password": "testpass123"})
    r = requests.post(f"{API}/auth/login", data={"username": email, "password": "testpass123"})
    tok = r.json()["access_token"]
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {tok}"
    s.uid = s.get(f"{API}/auth/me").json()["id"]
    return s


def wait_deploy(s, dep_id, timeout=300):
    end = time.time() + timeout
    while time.time() < end:
        d = s.get(f"{API}/deployments/{dep_id}").json()
        if d["status"] in ("live", "failed"):
            return d
        time.sleep(2)
    return d


def wait(pred, timeout=40, step=1):
    end = time.time() + timeout
    while time.time() < end:
        v = pred()
        if v:
            return v
        time.sleep(step)
    return None


alice = user("alice@example.com")
bob = user("bob@example.com")

# --- validation ---
bad = [
    {"name": "x", "repo_url": REPO},
    {"name": "Bad_Name", "repo_url": REPO},
    {"name": "ok-name-", "repo_url": REPO},
    {"name": "okname", "repo_url": "https://gitlab.com/a/b"},
    {"name": "okname", "repo_url": "https://github.com/a/b;rm -rf /"},
    {"name": "okname", "repo_url": "https://user:pw@github.com/a/b"},
    {"name": "okname", "repo_url": "https://github.com/-a/b"},
    {"name": "okname", "repo_url": REPO, "branch": "--upload-pack=x"},
]
check("validation rejects bad input", all(alice.post(f"{API}/deploy", json=b).status_code == 422 for b in bad))

# --- deploy (async, 202) with env var ---
t0 = time.time()
r = alice.post(f"{API}/deploy", json={"name": "web", "repo_url": REPO, "env": {"GREETING": "hi-secret-value"}})
check("deploy returns 202 fast", r.status_code == 202 and time.time() - t0 < 2, f"{r.status_code} {time.time()-t0:.2f}s")
dep = r.json()["deployment_id"]
d = wait_deploy(alice, dep)
check("deployment goes live", d["status"] == "live", d.get("error") or "")
check("build log captured", any("Building image" in l for l in d["log"]) and len(d["log"]) > 5, f"{len(d['log'])} lines")
check("commit sha recorded", bool(d["commit_sha"]) and len(d["commit_sha"]) == 40)
check("port auto-detected from EXPOSE", any("5000 (from Dockerfile EXPOSE)" in l for l in d["log"]))

rb = bob.post(f"{API}/deploy", json={"name": "web", "repo_url": REPO})
db_ = wait_deploy(bob, rb.json()["deployment_id"])
check("bob deploys same name", db_["status"] == "live", db_.get("error") or "")

# --- routing ---
ra = requests.get("http://localhost/", headers={"Host": f"web-{alice.uid}.localhost"}, timeout=5)
rbb = requests.get("http://localhost/", headers={"Host": f"web-{bob.uid}.localhost"}, timeout=5)
check("subdomain routing alice", ra.status_code == 200, ra.text[:60])
check("subdomain routing bob", rbb.status_code == 200, rbb.text[:60])

# --- container hardening ---
ca = dc.containers.get(f"paas-{alice.uid}-web")
hc = ca.attrs["HostConfig"]
check("limits applied", hc["Memory"] == 512 * 1024 * 1024 and hc["NanoCpus"] == 500_000_000
      and hc["PidsLimit"] == 256 and "no-new-privileges:true" in (hc["SecurityOpt"] or []))
check("env injected", "GREETING=hi-secret-value" in ca.attrs["Config"]["Env"])
nets = list(ca.attrs["NetworkSettings"]["Networks"])
check("only on own network", nets == [f"paas-user-{alice.uid}"], str(nets))

# --- isolation: alice's container cannot reach bob's ---
cb = dc.containers.get(f"paas-{bob.uid}-web")
bob_ip = cb.attrs["NetworkSettings"]["Networks"][f"paas-user-{bob.uid}"]["IPAddress"]
probe = f"import urllib.request;urllib.request.urlopen('http://{bob_ip}:5000',timeout=3);print('REACHED')"
code, out = ca.exec_run(["python", "-c", probe])
check("cross-user network blocked", b"REACHED" not in out and code != 0, f"bob ip {bob_ip}, exit {code}")
# sanity: the probe itself works against alice's own container
own_ip = ca.attrs["NetworkSettings"]["Networks"][f"paas-user-{alice.uid}"]["IPAddress"]
code2, out2 = ca.exec_run(["python", "-c", probe.replace(bob_ip, own_ip)])
check("probe works on own network (control)", b"REACHED" in out2, f"exit {code2}")

# --- ownership: 404 not 403 ---
codes = [bob.get(f"{API}/apps/web").status_code]  # bob has his own 'web'... use alice-only name below
alice.post(f"{API}/deploy", json={"name": "only-alice", "repo_url": REPO})
codes = [bob.get(f"{API}/apps/only-alice").status_code,
         bob.post(f"{API}/apps/only-alice/stop").status_code,
         bob.get(f"{API}/apps/only-alice/env").status_code,
         bob.get(f"{API}/deployments/{dep}").status_code,
         bob.get(f"{API}/apps/only-alice/webhook").status_code]
check("other user's app -> 404", all(c == 404 for c in codes), str(codes))

# --- env vars: masked, reveal, needs_redeploy ---
lst = alice.get(f"{API}/apps/web/env").json()
check("env masked in list", lst and lst[0]["value"] != "hi-secret-value")
check("env reveal", alice.get(f"{API}/apps/web/env/GREETING/reveal").json()["value"] == "hi-secret-value")
raw = sqlite3.connect("/home/fixadmin/paas-project/backend/paas.db").execute(
    "select value_encrypted from env_vars").fetchall()
check("env encrypted at rest", all("hi-secret-value" not in v[0] for v in raw))
alice.put(f"{API}/apps/web/env", json={"vars": {"NEW_VAR": "1"}})
check("needs_redeploy after env change", alice.get(f"{API}/apps/web").json()["needs_redeploy"] is True)

# --- stop must not be undone by the watcher ---
alice.post(f"{API}/apps/web/stop")
time.sleep(12)
check("stopped app stays stopped", dc.containers.get(f"paas-{alice.uid}-web").status == "exited")
alice.post(f"{API}/apps/web/start")

# --- recovery: kill -> restarted ---
dc.containers.get(f"paas-{alice.uid}-web").kill()
ok = wait(lambda: dc.containers.get(f"paas-{alice.uid}-web").status == "running" and
          alice.get(f"{API}/apps/web").json()["restart_count"] >= 1, timeout=30)
check("killed container auto-restarts", bool(ok))

# --- crash loop: keep killing; after 5 restarts -> failed ---
for i in range(8):
    c = dc.containers.get(f"paas-{alice.uid}-web")
    if c.status == "running":
        c.kill()
    st = wait(lambda: (dc.containers.get(f"paas-{alice.uid}-web").status == "running") or
              alice.get(f"{API}/apps/web").json()["desired_state"] == "failed", timeout=20)
    if alice.get(f"{API}/apps/web").json()["desired_state"] == "failed":
        break
summary = alice.get(f"{API}/apps/web").json()
check("crash loop -> failed", summary["desired_state"] == "failed" and summary["status"] == "failed",
      f"restarts={summary['restart_count']}")
time.sleep(8)
check("failed app is not restarted", dc.containers.get(f"paas-{alice.uid}-web").status == "exited")
evs = [e["type"] for e in alice.get(f"{API}/apps/web/events").json()]
check("events recorded", "crash_loop" in evs and "restart" in evs and "stopped" in evs, ",".join(evs[:8]))

# --- redeploy recovers + keeps old container on failure ---
r = alice.post(f"{API}/apps/web/redeploy")
d = wait_deploy(alice, r.json()["deployment_id"])
check("redeploy live, state reset", d["status"] == "live" and alice.get(f"{API}/apps/web").json()["desired_state"] == "running")
check("redeploy applied env", "NEW_VAR=1" in dc.containers.get(f"paas-{alice.uid}-web").attrs["Config"]["Env"])
before = dc.containers.get(f"paas-{alice.uid}-web").id
alice.patch(f"{API}/apps/web", json={"branch": "does-not-exist"})
r = alice.post(f"{API}/apps/web/redeploy")
d = wait_deploy(alice, r.json()["deployment_id"])
after = dc.containers.get(f"paas-{alice.uid}-web")
check("failed build keeps old container", d["status"] == "failed" and after.id == before and after.status == "running", (d.get("error") or "")[:80])
alice.patch(f"{API}/apps/web", json={"branch": None})

# --- webhook ---
info = alice.get(f"{API}/apps/web/webhook").json()
alice.patch(f"{API}/apps/web", json={"auto_deploy": True, "branch": "main"})
payload = json.dumps({"ref": "refs/heads/main", "repository": {"html_url": REPO},
                      "head_commit": {"id": "a" * 40, "message": "test push"}}).encode()
sig = "sha256=" + hmac.new(info["secret"].encode(), payload, hashlib.sha256).hexdigest()
hdr = {"Content-Type": "application/json", "X-GitHub-Event": "push"}
bad = requests.post(f"{API}/webhooks/github", data=payload, headers={**hdr, "X-Hub-Signature-256": "sha256=" + "0" * 64})
check("webhook bad signature -> 401", bad.status_code == 401)
good = requests.post(f"{API}/webhooks/github", data=payload, headers={**hdr, "X-Hub-Signature-256": sig})
queued = good.json().get("queued", [])
check("webhook queues only alice's app", good.status_code == 200 and len(queued) == 1, good.text)
if queued:
    d = wait_deploy(alice, queued[0])
    check("webhook deployment live", d["status"] == "live" and d["trigger"] == "webhook", d.get("error") or "")
ping = requests.post(f"{API}/webhooks/github", data=payload, headers={**hdr, "X-GitHub-Event": "ping", "X-Hub-Signature-256": sig})
check("webhook ping", ping.json().get("message") == "pong")

# --- metrics + overview ---
time.sleep(12)
pts = alice.get(f"{API}/apps/web/metrics?minutes=15").json()
check("metrics points", len(pts) >= 2 and "disk_mb" in pts[-1], f"{len(pts)} points, last={pts[-1] if pts else None}")
ov = alice.get(f"{API}/system/overview").json()
check("overview", ov["apps"] >= 2 and ov["running"] >= 1 and ov["mem_mb"] > 0, json.dumps(ov))

# --- rate limit on login ---
codes = [requests.post(f"{API}/auth/login", data={"username": "nobody@x.io", "password": "wrongwrong"}).status_code for _ in range(12)]
check("login rate limited", 429 in codes, str(codes[-3:]))

print(f"\n{sum(ok for _, ok in results)}/{len(results)} passed")
sys.exit(0 if all(ok for _, ok in results) else 1)

