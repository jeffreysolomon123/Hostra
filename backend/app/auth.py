import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from . import models
from .config import SECRET_KEY  # anyone who knows it can forge logins
from .database import get_db

ALGORITHM = "HS256"
TOKEN_LIFETIME = timedelta(hours=24)

# tells FastAPI (and the /docs Authorize button) where to log in
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(password: str) -> str:
    # bcrypt only looks at the first 72 bytes
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode()[:72], hashed.encode())


def create_access_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + TOKEN_LIFETIME,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


# ---------- WebSocket tickets ----------
# Browsers cannot send an Authorization header when opening a WebSocket, and putting
# the 24h login token in the URL would leak it into logs and browser history. So the
# client first asks (with its normal token) for a ticket that is:
#   - short-lived  (30s: just long enough to open the socket)
#   - single-use   (its random id "jti" is remembered until it expires)
#   - bound to the user id and to the purpose "ws" (a ticket is not a login token)
WS_TICKET_LIFETIME = timedelta(seconds=30)
_used_tickets: dict[str, float] = {}  # jti -> expiry timestamp
_tickets_lock = threading.Lock()


def create_ws_ticket(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "purpose": "ws",
        "jti": secrets.token_urlsafe(16),
        "exp": datetime.now(timezone.utc) + WS_TICKET_LIFETIME,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def consume_ws_ticket(ticket: str | None) -> int | None:
    """Returns the user id, or None if the ticket is invalid, expired or already used."""
    if not ticket:
        return None
    try:
        payload = jwt.decode(ticket, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("purpose") != "ws":
            return None
        user_id, jti, exp = int(payload["sub"]), payload["jti"], float(payload["exp"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
    now_ts = time.time()
    with _tickets_lock:
        for old in [j for j, e in _used_tickets.items() if e < now_ts]:
            del _used_tickets[old]  # forget expired ones; they fail the exp check anyway
        if jti in _used_tickets:
            return None
        _used_tickets[jti] = exp
    return user_id


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    """Dependency: put it on an endpoint to require login."""
    error = HTTPException(
        401, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"}
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if "purpose" in payload:  # a WS ticket must never work as a login token
            raise error
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise error
    user = db.get(models.User, user_id)
    if user is None:
        raise error
    return user