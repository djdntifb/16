from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import create_access_token, verify_password
from ..deps import CurrentUser, DB
from ..models import User
from ..schemas import LoginRequest, TokenResponse, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: DB):
    user = db.query(User).filter(User.email == body.email, User.deleted == False).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return {"access_token": token, "token_type": "bearer", "user": UserOut.model_validate(user)}


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    return user
