import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from . import models
from .database import get_db

# In real use, set this as an environment variable. Anyone who knows it can forge logins.
SECRET_KEY = os.environ.get("PAAS_SECRET_KEY", "dev-only-secret-change-me")
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
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise error
    user = db.get(models.User, user_id)
    if user is None:
        raise error
    return user