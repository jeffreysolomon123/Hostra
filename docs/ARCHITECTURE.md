# Hostra: design decisions and trade-offs

Each section is a decision I would expect to defend: what I chose, why, and what I gave up.

## 1. Desired state vs actual state (the recovery watcher)

**Decision.** The database stores what *should* be true (`apps.desired_state` =
`running | stopped | failed`). Docker is the source of truth for what *is* true. A background
loop (`recovery.py`, every 5s) compares the two and fixes differences: it restarts containers
that should run but have exited or report `unhealthy`.

**Why.** This is the reconciliation pattern Kubernetes controllers use. It is level-triggered:
if the API was down when a container died, the next tick still notices, because it looks at
*state*, not at missed *events*. It also makes user intent explicit: a container that exited
because the user pressed Stop and one that crashed look identical in Docker, and only
`desired_state` tells them apart.

**Race conditions.** Stop sets `desired_state=stopped` and commits **before** stopping the
container. That alone still leaves a window (the watcher reads "running", the user stops, the
watcher restarts it), so every container mutation takes a per-app lock (`locks.py`), and the
watcher **re-reads** `desired_state` while holding it. Builds use a separate per-app lock so a
5-minute build does not block Stop.

**Crash loops.** Restarting forever hides a broken app and burns CPU. More than 5 restarts in
5 minutes sets `desired_state=failed` and stops retrying. The restart history is just the
`restart` rows in the `events` table (no extra columns), counted since the last Start/deploy so
a manual Start gets a fresh budget. Docker's own restart policy is set to `no`, because then
the platform owns restarts and can count, log and stream them.

**Trade-off.** Polling every 5s means up to ~5s of downtime before a restart, and N Docker
calls per tick. The Docker events stream would react faster, but you then need a periodic
resync anyway to be correct, so polling is the simple correct core.

## 2. Deployments as rows + a worker pool

`POST /deploy` only writes a `queued` row and returns 202. Two worker threads do the slow part.
A request that blocks for minutes ties up a server thread, dies with the client's connection
and cannot report progress. A row with a status can be listed, streamed, retried, and survives
page reloads. `MAX_CONCURRENT_BUILDS=2` because builds are CPU and disk heavy. On startup,
rows still `queued/building` are marked failed ("interrupted by a server restart"). Honest
beats stuck.

**Swap, not replace.** The new container starts next to the old one as `paas-<slug>-next`. Only
if it is still running after 3s is the old one removed and the new one renamed. Both carry the
same Traefik router labels, so for a moment Traefik load-balances across both. Combined with a
retry middleware, a 2s dial timeout and a 200ms provider throttle, a redeploy measured
**0 failed requests out of 101**. Trade-off: a 3s startup check is a heuristic; a real
readiness probe (HTTP health check) would be better.

## 3. Traefik with Docker label discovery

**Decision.** Each app container carries labels such as
``traefik.http.routers.<slug>.rule=Host(`web-1.localhost`)``. Traefik watches the Docker socket
and builds its routing table from them.

**Why.** No config files to template, no reloads, and routing state lives with the container,
so it cannot drift: if the container is gone, so is its route. Adding an app is just
`docker run` with labels.

**Trade-offs.** Traefik needs the Docker socket (read-only here, but the socket is still
powerful), and label typos fail silently. Two containers with *different* labels for the same
router conflict, so Traefik drops the router (a known ~3s 404 window when a redeploy changes
the port).

## 4. Own metrics collector vs Prometheus + cAdvisor

**Decision.** `collector.py` calls `container.stats(stream=False)` every 5s, stores raw counters
in SQLite for 1 hour, and the API turns network byte counters into rates:
`max(curr - prev, 0) / seconds`. The `max` handles counter resets after restarts. Disk usage
(writable layer size) costs a filesystem walk, so it is sampled every 60s in one Docker call.

**Why.** Zero extra services on a laptop, and the whole data path fits in one file I can explain
line by line. Each `stats` call takes ~1-2s (Docker waits for two CPU samples), so reads run in
a thread pool; sequential reads would blow the 5s budget at about 4 apps.

**When to switch.** More than a handful of hosts or apps, alerting, long retention, or
percentiles → cAdvisor + Prometheus (pull, TSDB, PromQL) + Grafana. SQLite is a poor time-series
store and polling `stats` per container does not scale.

## 5. WebSocket tickets

**Problem.** Browsers cannot set an `Authorization` header when opening a WebSocket. Common
workarounds are bad: a cookie needs CSRF protection and Origin checks, and the 24h JWT in the
query string leaks into proxy logs, browser history and Referer headers.

**Decision.** `POST /auth/ws-ticket` (normal Bearer auth) returns a JWT that is:
- **30 seconds** long-lived (just enough to open the socket),
- **single-use**: its random `jti` is remembered until expiry and replays are rejected,
- **purpose-bound** (`purpose: "ws"`): it is rejected as a login token, and a login token is
  rejected as a ticket.

The server accepts the socket and then closes it with **4401** on a bad ticket or **4404** for an
app you do not own (mirroring the HTTP 404 rule), so the client knows whether to fetch a new
ticket or give up. A leaked ticket is worthless within 30s or after one use. Cross-site
WebSocket hijacking is also prevented, because a malicious page cannot obtain a ticket (CORS
protects the ticket endpoint).

**Client.** One hook (`useWebSocket`) fetches a fresh ticket on every (re)connect, retries with
exponential backoff + jitter, shows Live/Reconnecting, and pages fall back to REST polling
while the socket is down.

**Threads → asyncio.** Docker log streams and build workers are blocking threads. They publish
through `bus.py`, which hands messages to the event loop with `loop.call_soon_threadsafe`
(asyncio queues are not thread-safe). The build-log socket subscribes **before** reading the
log file and drops duplicates by line number, so no line is lost or doubled. Trade-off: the bus
is in-process; several API processes would need Redis pub/sub.

## 6. Per-user Docker networks

**Decision.** Each user gets a bridge network `paas-user-<id>`; their containers join only that
network. Traefik is connected to every user network (and reconnected automatically by the
watcher if Traefik is recreated). The label `traefik.docker.network` tells Traefik which
network to use.

**Why.** On one shared network every app can talk to every other user's app directly, e.g. an
internal admin port or an unauthenticated database. Verified in the test suite: `docker exec`
from user A's container to user B's container IP fails, while the same probe against A's own
network succeeds (the control case).

**Trade-offs.** Traefik is a member of every network (it is the trusted router). Apps can still
reach each other *through Traefik* by public hostname, exactly like the internet, and can reach
the internet and the host. Egress filtering and network policies are future work. Docker's
default address pools limit you to roughly 30 bridge networks unless you configure
`default-address-pools`, which is fine for a laptop and not for thousands of tenants.

## 7. Secrets

- **Env vars** are encrypted with Fernet. The key is derived from `PAAS_SECRET_KEY` via HKDF
  with a purpose label, so the JWT signing key and the encryption key are different keys. Lists
  are masked; the plain value needs an explicit `/reveal` call. Only keys (never values) appear
  in the activity feed. Values are injected at `docker run`, never at build time, so they do not
  end up in image layers.
- **Webhook secrets** are derived per app: `HMAC(GITHUB_WEBHOOK_SECRET, "app:<id>")`. Users only
  ever see their own app's secret, nothing extra is stored, and the master secret never leaves
  the server. Verification recomputes HMAC-SHA256 over the **raw body bytes** and compares with
  `hmac.compare_digest` (constant time).
- Trade-off: rotating `PAAS_SECRET_KEY` invalidates every session and makes stored env vars
  unreadable. A real system keeps keys in a KMS/Vault with versioned rotation.

## 8. Input is hostile

Repo URLs are allow-listed (`https://github.com/<owner>/<repo>` only, no credentials, no other
hosts), and `git clone ... -- <url>` uses `--` so nothing can become a git flag. Branch names
cannot start with `-`. App names are DNS-label safe because they become hostnames and Traefik
router names. Git runs with `GIT_TERMINAL_PROMPT=0` (a private repo fails fast instead of
hanging) and without our secrets in its environment. Clone and build have timeouts; login,
signup and deploy are rate limited. User code only ever runs inside a container, never on the
host. The honest caveat remains: `docker build` itself is not a security boundary (see the
README's limitations).

## 9. SQLite specifics

- WAL mode + a 15s busy timeout, because four kinds of threads write concurrently.
- `create_all()` never adds columns to existing tables, so `database.migrate()` checks
  `PRAGMA table_info` and runs `ALTER TABLE ... ADD COLUMN` only for missing ones. It is
  idempotent on every startup and keeps old databases working without Alembic.
- SQLite has no timezone type. A small `UTCDateTime` column type stores naive UTC and always
  returns aware UTC, which fixed real "can't subtract offset-naive and offset-aware" bugs.
