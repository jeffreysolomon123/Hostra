"""Tiny in-process pub/sub that connects background THREADS to async WebSocket handlers.

Background threads (build workers, recovery watcher) call publish() from plain
threads. WebSocket handlers live on the asyncio event loop and read from an
asyncio.Queue. asyncio queues are not thread-safe, so publish() hands each
message to the loop with call_soon_threadsafe(), which is the one sanctioned way
to touch the loop from another thread.

Topics:  "user:<id>"        -> dashboard events for one user
         "build:<deploy_id>" -> build log lines and status for one deployment

Single process only. With several API processes you would swap this for Redis pub/sub.
"""
import asyncio
import threading

_subscribers: dict[str, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = {}
_lock = threading.Lock()


def subscribe(topic: str) -> asyncio.Queue:
    """Call from async code. Returns a queue that receives every message on the topic."""
    q: asyncio.Queue = asyncio.Queue(maxsize=2000)
    entry = (asyncio.get_running_loop(), q)
    with _lock:
        _subscribers.setdefault(topic, set()).add(entry)
    return q


def unsubscribe(topic: str, q: asyncio.Queue):
    with _lock:
        subs = _subscribers.get(topic, set())
        for entry in list(subs):
            if entry[1] is q:
                subs.discard(entry)
        if not subs:
            _subscribers.pop(topic, None)


def _put(q: asyncio.Queue, message):
    try:
        q.put_nowait(message)
    except asyncio.QueueFull:
        pass  # a stuck client must not grow memory forever; it can resync via REST


def publish(topic: str, message: dict):
    """Safe to call from ANY thread."""
    with _lock:
        targets = list(_subscribers.get(topic, ()))
    for loop, q in targets:
        try:
            loop.call_soon_threadsafe(_put, q, message)
        except RuntimeError:
            pass  # that loop has shut down
