"""A deliberately broken app, to demo auto-recovery and crash-loop protection.

It serves HTTP for CRASH_AFTER seconds (long enough to pass the platform's
3-second startup check, so the deployment goes live) and then exits with code 1.
The recovery watcher restarts it; after 5 restarts in 5 minutes it gives up and
marks the app "failed".
"""
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

CRASH_AFTER = float(os.environ.get("CRASH_AFTER", "10"))
PORT = int(os.environ.get("PORT", 8000))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"I am about to crash...\n")


def crash_later():
    time.sleep(CRASH_AFTER)
    print(f"Simulated fatal error after {CRASH_AFTER:.0f}s, exiting with code 1", flush=True)
    os._exit(1)


if __name__ == "__main__":
    print(f"crashy: serving on :{PORT}, will crash in {CRASH_AFTER:.0f}s", flush=True)
    threading.Thread(target=crash_later, daemon=True).start()
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
    sys.exit(0)
