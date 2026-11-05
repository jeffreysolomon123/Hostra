import shutil
import subprocess
from pathlib import Path

import docker

from .config import DOMAIN

client = docker.from_env()

WORKDIR = Path(__file__).resolve().parent.parent / "workdir"
WORKDIR.mkdir(exist_ok=True)

LABEL = "paas.managed"
NETWORK = "paas-net"


def make_slug(owner_id: int, name: str) -> str:
    return f"{owner_id}-{name}"


def app_url(owner_id: int, name: str) -> str:
    return f"http://{name}-{owner_id}.{DOMAIN}"


def clone_repo(repo_url: str, slug: str) -> Path:
    dest = WORKDIR / slug
    if dest.exists():
        shutil.rmtree(dest)
    subprocess.run(
        ["git", "clone", "--depth", "1", "--", repo_url, str(dest)],
        check=True,
        capture_output=True,
        text=True,
    )
    if not (dest / "Dockerfile").exists():
        raise FileNotFoundError("No Dockerfile found in the repo root")
    return dest


def build_image(path: Path, slug: str) -> str:
    tag = f"paas-{slug}:latest"
    client.images.build(path=str(path), tag=tag, rm=True)
    return tag


def run_container(slug: str, owner_id: int, name: str, tag: str, port: int):
    try:
        client.containers.get(f"paas-{slug}").remove(force=True)
    except docker.errors.NotFound:
        pass

    host = f"{name}-{owner_id}.{DOMAIN}"
    client.containers.run(
        tag,
        name=f"paas-{slug}",
        detach=True,
        network=NETWORK,
        labels={
            LABEL: "true",
            "paas.app": name,
            "paas.owner": str(owner_id),
            "traefik.enable": "true",
            f"traefik.http.routers.{slug}.rule": f"Host(`{host}`)",
            f"traefik.http.routers.{slug}.entrypoints": "web",
            f"traefik.http.services.{slug}.loadbalancer.server.port": str(port),
        },
    )


def _get(slug: str):
    return client.containers.get(f"paas-{slug}")


def get_status(slug: str) -> str:
    """Live status straight from Docker: running, exited, ... or 'missing'."""
    try:
        return _get(slug).status
    except docker.errors.NotFound:
        return "missing"


def stop_app(slug: str):
    _get(slug).stop()


def start_app(slug: str):
    _get(slug).start()


def delete_app(slug: str):
    try:
        _get(slug).remove(force=True)
    except docker.errors.NotFound:
        pass
    try:
        client.images.remove(f"paas-{slug}:latest", force=True)
    except docker.errors.ImageNotFound:
        pass
    shutil.rmtree(WORKDIR / slug, ignore_errors=True)


def get_logs(slug: str, tail: int = 100) -> str:
    return _get(slug).logs(tail=tail).decode("utf-8", errors="replace")






def list_running():
    """All running containers that this platform created."""
    return client.containers.list(
        filters={"label": f"{LABEL}=true", "status": "running"}
    )


def read_stats(container) -> dict:
    """One snapshot of CPU %, memory and network totals for a container."""
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
    cache = stats.get("inactive_file", stats.get("cache", 0))
    mem_bytes = max(mem.get("usage", 0) - cache, 0)

    nets = s.get("networks", {})
    return {
        "cpu_percent": round(cpu_percent, 2),
        "mem_bytes": mem_bytes,
        "net_rx": sum(n["rx_bytes"] for n in nets.values()),
        "net_tx": sum(n["tx_bytes"] for n in nets.values()),
    }