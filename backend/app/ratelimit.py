"""Simple in-memory sliding-window rate limiter, used as a FastAPI dependency.

Keeps the timestamps of recent hits per (bucket, key) and rejects with 429 once
there are `limit` hits inside the last `window` seconds. In-memory means it resets
on restart and does not work across several processes (Redis would fix both).
"""
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_hits: dict[tuple[str, str], deque] = defaultdict(deque)
_lock = threading.Lock()


def check(bucket: str, key: str, limit: int, window: float):
    now = time.monotonic()
    with _lock:
        q = _hits[(bucket, key)]
        while q and q[0] <= now - window:
            q.popleft()
        if len(q) >= limit:
            retry = int(window - (now - q[0])) + 1
            raise HTTPException(429, "Too many requests, slow down",
                                headers={"Retry-After": str(retry)})
        q.append(now)


def by_ip(bucket: str, limit: int, window: float):
    """Dependency factory: rate limit by client IP (login/signup)."""
    def dep(request: Request):
        check(bucket, request.client.host if request.client else "?", limit, window)
    return dep
