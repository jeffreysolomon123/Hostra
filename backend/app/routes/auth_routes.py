from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import auth, models, ratelimit
from ..database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)  # bcrypt ignores bytes after 72


@router.post("/signup", status_code=201,
             dependencies=[Depends(ratelimit.by_ip("signup", limit=5, window=60))])
def signup(req: SignupRequest, db: Session = Depends(get_db)):
    user = models.User(email=req.email.lower(), password_hash=auth.hash_password(req.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists")
    return {"id": user.id, "email": user.email}


@router.post("/login",
             dependencies=[Depends(ratelimit.by_ip("login", limit=10, window=60))])
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # the OAuth2 form field is called "username", but we use it for the email
    user = db.scalar(select(models.User).where(models.User.email == form.username.lower()))
    if user is None or not auth.verify_password(form.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    return {"access_token": auth.create_access_token(user.id), "token_type": "bearer"}


@router.get("/me")
def me(user: models.User = Depends(auth.get_current_user)):
    return {"id": user.id, "email": user.email}
