"""One lock per app, shared by the API, the build workers and the recovery watcher.

Why: without it, this race exists -
  1. watcher sees desired_state=running and container "exited"
  2. user clicks Stop: desired_state=stopped, container stopped
  3. watcher (still acting on its old reading) restarts the container
Anything that changes an app's container or desired_state takes this lock first,
and the watcher re-reads desired_state while holding it, so steps cannot interleave.
"""
import threading

_locks: dict[str, threading.Lock] = {}
_build_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


def app_lock(slug: str) -> threading.Lock:
    """Short-lived: held only while changing the container / desired_state."""
    with _guard:
        return _locks.setdefault(slug, threading.Lock())


def build_lock(slug: str) -> threading.Lock:
    """Long-lived: one build per app at a time (they share workdir/<slug>).
    Separate from app_lock so a 5-minute build does not block Stop or the watcher."""
    with _guard:
        return _build_locks.setdefault(slug, threading.Lock())
