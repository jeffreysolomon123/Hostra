import os
import socket

from flask import Flask

app = Flask(__name__)


@app.get("/")
def index():
    greeting = os.environ.get("GREETING", "Hello")
    return f"{greeting} from Hostra! (container {socket.gethostname()})\n"


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    # 0.0.0.0, not 127.0.0.1: inside a container, localhost is only the container
    # itself, so Traefik (another container) could not reach the app.
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
