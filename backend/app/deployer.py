"""Low-level Docker + git operations. No database code lives here.

Every function in this module BLOCKS (git subprocess, Docker HTTP API). They are only
ever called from background threads or from sync FastAPI endpoints (which FastAPI
runs in its threadpool), never directly on the asyncio event loop.
"""
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Callable

import docker

from .config import DOMAIN

client = docker.from_env()

WORKDIR = Path(__file__).resolve().parent.parent / "workdir"
WORKDIR.mkdir(exist_ok=True)

LABEL = "paas.managed"
LEGACY_NETWORK = "paas-net"      # Traefik's own network (and v1 apps)
TRAEFIK_CONTAINER = "paas-traefik"
DEFAULT_PORT = 8000

CLONE_TIMEOUT = 120              # seconds
BUILD_TIMEOUT = 600              # seconds for the whole image build
STARTUP_CHECK = 3                # seconds a new container must stay up before going live

# Applied to every app container. These are the numbers shown in the UI.
LIMITS = {
    "memory": "512m",
    "cpus": 0.5,
    "pids": 256,
}


class DeployError(Exception):
    """A user-facing deploy failure (bad repo, failed build, crashing container)."""


def make_slug(owner_id: int, name: str) -> str:
    return f"{owner_id}-{name}"


def container_name(slug: str) -> str:
    return f"paas-{slug}"


def image_tag(slug: str) -> str:
    return f"paas-{slug}:latest"


def user_network(owner_id: int) -> str:
    return f"paas-user-{owner_id}"


def app_host(owner_id: int, name: str) -> str:
    return f"{name}-{owner_id}.{DOMAIN}"


def app_url(owner_id: int, name: str) -> str:
    return f"http://{app_host(owner_id, name)}"


# ---------- git ----------

def _git(args: list[str], cwd: Path | None = None, timeout: int = 30) -> str:
    env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",  # private/missing repo: fail fast instead of waiting for a password
    }
    env.pop("PAAS_SECRET_KEY", None)  # git never needs our secrets
    env.pop("GITHUB_WEBHOOK_SECRET", None)
    result = subprocess.run(["git", *args], cwd=cwd, env=env, check=True,
                            capture_output=True, text=True, timeout=timeout)
    return result.stdout.strip()


def clone_repo(repo_url: str, slug: str, branch: str | None) -> Path:
    """Shallow clone into workdir/<slug>. The URL and branch are already validated."""
    dest = WORKDIR / slug
    if dest.exists():
        shutil.rmtree(dest)
    args = ["clone", "--depth", "1"]
    if branch:
        args += ["--branch", branch]
    # "--" ends option parsing: even a URL starting with "-" can never become a git flag
    args += ["--", repo_url, str(dest)]
    try:
        _git(args, timeout=CLONE_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise DeployError(f"git clone timed out after {CLONE_TIMEOUT}s")
    except subprocess.CalledProcessError as e:
        raise DeployError(f"git clone failed: {e.stderr.strip()[-500:]}")
    if not (dest / "Dockerfile").is_file():
        raise DeployError("No Dockerfile found in the repo root")
    return dest


def commit_info(path: Path) -> tuple[str, str, str]:
    """(sha, subject line, branch) of the cloned HEAD."""
    sha, subject = _git(["log", "-1", "--format=%H%n%s"], cwd=path).split("\n", 1)
    branch = _git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=path)
    return sha, subject[:500], branch


def detect_port(path: Path) -> int:
    """First EXPOSE in the Dockerfile ("EXPOSE 5000/tcp 8080" -> 5000), else 8000."""
    for line in (path / "Dockerfile").read_text(errors="replace").splitlines():
        m = re.match(r"^\s*EXPOSE\s+(\d+)", line, re.IGNORECASE)
        if m and 1 <= int(m.group(1)) <= 65535:
            return int(m.group(1))
    return DEFAULT_PORT


# ---------- build ----------

def build_image(path: Path, slug: str, on_line: Callable[[str], None]) -> str:
    """Build and stream every output line to on_line. Raises DeployError on failure.

    client.api.build(decode=True) is the low-level API: it yields one dict per
    message ({"stream": "..."} or {"error": "..."}) as the build runs, which is what
    lets us show a live build log. The high-level images.build() only returns at the end.
    """
    tag = image_tag(slug)
    # Separate client whose HTTP read timeout is the build timeout, so a build that
    # prints nothing for BUILD_TIMEOUT seconds also fails instead of hanging forever.
    build_client = docker.from_env(timeout=BUILD_TIMEOUT)
    deadline = time.monotonic() + BUILD_TIMEOUT
    try:
        for chunk in build_client.api.build(path=str(path), tag=tag, rm=True,
                                            forcerm=True, decode=True):
            if "error" in chunk:
                raise DeployError(f"Docker build failed: {chunk['error'].strip()}")
            text = chunk.get("stream") or chunk.get("status") or ""
            for line in text.split("\n"):
                if line.strip():  # Docker sends many bare/leading "\n"; skip empty lines
                    on_line(line.rstrip())
            if time.monotonic() > deadline:
                raise DeployError(f"Build timed out after {BUILD_TIMEOUT}s")
    except docker.errors.APIError as e:
        raise DeployError(f"Docker build failed: {e.explanation or e}")
    except Exception as e:  # read timeout from the HTTP layer
        if isinstance(e, DeployError):
            raise
        raise DeployError(f"Build aborted: {e}")
    finally:
        build_client.close()
    return tag


# ---------- networks ----------

def ensure_user_network(owner_id: int) -> str:
    """Each user gets an isolated bridge network. Traefik joins all of them so it can
    route to every app, but apps of different users share no network at all."""
    name = user_network(owner_id)
    try:
        net = client.networks.get(name)
    except docker.errors.NotFound:
        net = client.networks.create(name, driver="bridge",
                                     labels={LABEL: "true", "paas.owner": str(owner_id)})
    connect_traefik(net)
    return name


def connect_traefik(net):
    try:
        net.connect(TRAEFIK_CONTAINER)
    except docker.errors.APIError as e:
        # 'already exists' / 'is already attached' is fine; Traefik not running is not
        # fatal here (the watcher reconnects it later), but we say so.
        if "already" not in str(e).lower():
            print(f"[deployer] could not connect traefik to {net.name}: {e.explanation or e}")


def connect_traefik_to_all_user_networks():
    """Traefik loses these connections when its container is recreated (docker compose
    up). The watcher calls this regularly so routing heals by itself."""
    try:
        traefik = client.containers.get(TRAEFIK_CONTAINER)
    except docker.errors.NotFound:
        return
    attached = set(traefik.attrs["NetworkSettings"]["Networks"])
    for net in client.networks.list(filters={"label": f"{LABEL}=true"}):
        if net.name not in attached:
            connect_traefik(net)


# ---------- run ----------

def _labels(slug: str, owner_id: int, name: str, port: int, network: str, deployment_id: int):
    host = app_host(owner_id, name)
    return {
        LABEL: "true",
        "paas.app": name,
        "paas.owner": str(owner_id),
        "paas.deployment": str(deployment_id),
        "traefik.enable": "true",
        f"traefik.http.routers.{slug}.rule": f"Host(`{host}`)",
        f"traefik.http.routers.{slug}.entrypoints": "web",
        f"traefik.http.services.{slug}.loadbalancer.server.port": str(port),
        # During a redeploy swap one of the two containers may refuse connections
        # (still booting, or just removed). Retry sends the request to the other one.
        f"traefik.http.middlewares.{slug}-retry.retry.attempts": "3",
        f"traefik.http.middlewares.{slug}-retry.retry.initialinterval": "100ms",
        f"traefik.http.routers.{slug}.middlewares": f"{slug}-retry",
        # Containers can be on several networks; tell Traefik which one to use.
        "traefik.docker.network": network,
    }


def run_container(slug: str, owner_id: int, name: str, port: int,
                  env: dict[str, str], deployment_id: int):
    """Start the new image next to the old container, then swap.

    1. start "paas-<slug>-next" from the freshly built image
    2. wait STARTUP_CHECK seconds; if it already died, delete it and raise.
       The OLD container was never touched, so the app stays up.
    3. remove the old container and rename -next to paas-<slug>.
    Both containers carry the same Traefik router labels for a moment, so Traefik
    briefly load-balances across both: close to zero downtime.
    """
    network = ensure_user_network(owner_id)
    final_name = container_name(slug)
    next_name = final_name + "-next"
    remove_container(next_name)  # leftover from an interrupted deploy

    new = client.containers.run(
        image_tag(slug),
        name=next_name,
        detach=True,
        network=network,
        environment={**env, "PORT": str(port)},
        labels=_labels(slug, owner_id, name, port, network, deployment_id),
        # resource limits: one app cannot starve the laptop
        mem_limit=LIMITS["memory"],
        nano_cpus=int(LIMITS["cpus"] * 1e9),
        pids_limit=LIMITS["pids"],          # stops fork bombs
        security_opt=["no-new-privileges:true"],  # setuid binaries cannot gain root
        restart_policy={"Name": "no"},      # our watcher restarts, so we can count restarts
    )

    time.sleep(STARTUP_CHECK)
    new.reload()
    if new.status != "running":
        logs = new.logs(tail=30).decode("utf-8", errors="replace")
        code = new.attrs["State"].get("ExitCode")
        new.remove(force=True)
        raise DeployError(f"Container exited during startup (exit code {code}). "
                          f"Last output:\n{logs}")

    old_image = None
    try:
        old = client.containers.get(final_name)
        old_image = old.image.id
        old.remove(force=True)
    except docker.errors.NotFound:
        pass
    new.rename(final_name)

    # Free the previous image. It fails harmlessly if it is the same image or still in use.
    if old_image and old_image != new.image.id:
        try:
            client.images.remove(old_image)
        except docker.errors.APIError:
            pass


# ---------- lifecycle ----------

def get_container(slug: str):
    try:
        return client.containers.get(container_name(slug))
    except docker.errors.NotFound:
        return None


def list_managed() -> dict[str, object]:
    """All containers this platform created (any state), keyed by container name.
    One Docker call instead of one per app."""
    return {c.name: c for c in client.containers.list(all=True, filters={"label": f"{LABEL}=true"})}


def health_of(container) -> str | None:
    """'healthy' / 'unhealthy' / 'starting', or None if the image has no HEALTHCHECK."""
    return (container.attrs.get("State", {}).get("Health") or {}).get("Status")


def stop_app(slug: str):
    c = get_container(slug)
    if c is None:
        raise docker.errors.NotFound("container missing")
    c.stop(timeout=10)


def start_app(slug: str):
    c = get_container(slug)
    if c is None:
        raise docker.errors.NotFound("container missing")
    c.start()


def remove_container(name: str):
    try:
        client.containers.get(name).remove(force=True)
    except docker.errors.NotFound:
        pass


def delete_app(slug: str):
    remove_container(container_name(slug))
    remove_container(container_name(slug) + "-next")
    try:
        client.images.remove(image_tag(slug), force=True)
    except docker.errors.ImageNotFound:
        pass
    shutil.rmtree(WORKDIR / slug, ignore_errors=True)


def get_logs(slug: str, tail: int = 100) -> str:
    c = get_container(slug)
    if c is None:
        raise docker.errors.NotFound("container missing")
    return c.logs(tail=tail, timestamps=False).decode("utf-8", errors="replace")


# ---------- metrics ----------

def list_running():
    return client.containers.list(filters={"label": f"{LABEL}=true", "status": "running"})


def read_stats(container) -> dict:
    """One snapshot of CPU %, memory and network totals for a container.

    CPU % works like `docker stats`: how much CPU time the container used between
    two samples, divided by how much CPU time passed on the whole machine.
    """
    s = container.stats(stream=False)

    cpu = s["cpu_stats"]
    pre = s["precpu_stats"]
    cpu_delta = cpu["cpu_usage"]["total_usage"] - pre["cpu_usage"].get("total_usage", 0)
    sys_delta = cpu.get("system_cpu_usage", 0) - pre.get("system_cpu_usage", 0)
    cpus = cpu.get("online_cpus") or 1
    cpu_percent = 0.0
    if sys_delta > 0 and cpu_delta >= 0:
        cpu_percent = (cpu_delta / sys_delta) * cpus * 100

    mem = s["memory_stats"]
    stats = mem.get("stats", {})
    # page cache is reclaimable, so subtract it (same as `docker stats`)
    cache = stats.get("inactive_file", stats.get("cache", 0))
    mem_bytes = max(mem.get("usage", 0) - cache, 0)

    nets = s.get("networks", {})
    return {
        "cpu_percent": round(cpu_percent, 2),
        "mem_bytes": mem_bytes,
        "net_rx": sum(n["rx_bytes"] for n in nets.values()),
        "net_tx": sum(n["tx_bytes"] for n in nets.values()),
    }


def disk_usage_all() -> dict[str, int]:
    """Writable layer size (files the app created/changed) of every managed container,
    keyed by container id, in ONE Docker call. Docker has to walk the filesystem to
    compute it, which is why the collector only asks every 60s."""
    rows = client.api.containers(filters={"label": f"{LABEL}=true"}, size=True)
    return {r["Id"]: r.get("SizeRw") or 0 for r in rows}
