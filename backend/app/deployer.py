import shutil
import subprocess
from pathlib import Path

import docker

client = docker.from_env()

WORKDIR = Path(__file__).resolve().parent.parent / "workdir"
WORKDIR.mkdir(exist_ok=True)

LABEL = "paas.managed"
NETWORK = "paas-net"
DOMAIN = "localhost"


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