import uuid

from fastapi import APIRouter, HTTPException, status

from ..auth import hash_password
from ..deps import AdminOnly, DB
from ..models import User
from ..schemas import UserCreate, UserOut, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(user: AdminOnly, db: DB):
    return db.query(User).filter(User.deleted == False).order_by(User.name).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, user: AdminOnly, db: DB):
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=400, detail="Email already in use")
    u = User(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: uuid.UUID, body: UserUpdate, actor: AdminOnly, db: DB):
    u = _get(user_id, db)
    if u.id == actor.id and body.role and body.role != actor.role:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    if body.name is not None:
        u.name = body.name
    if body.role is not None:
        u.role = body.role
    if body.password is not None:
        u.password_hash = hash_password(body.password)
    db.commit()
    db.refresh(u)
    return u


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: uuid.UUID, actor: AdminOnly, db: DB):
    u = _get(user_id, db)
    if u.id == actor.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    u.deleted = True
    db.commit()


def _get(user_id: uuid.UUID, db) -> User:
    u = db.query(User).filter(User.id == user_id, User.deleted == False).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return u
