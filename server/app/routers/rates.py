import uuid

from fastapi import APIRouter, HTTPException, status

from ..deps import AdminOnly, CurrentUser, DB
from ..models import Rate
from ..schemas import RateCreate, RateOut, RateUpdate

router = APIRouter(prefix="/rates", tags=["rates"])


@router.get("", response_model=list[RateOut])
def list_rates(user: CurrentUser, db: DB):
    return db.query(Rate).order_by(Rate.effective_from.desc()).all()


@router.post("", response_model=RateOut, status_code=status.HTTP_201_CREATED)
def create_rate(body: RateCreate, user: AdminOnly, db: DB):
    rate = Rate(**body.model_dump())
    db.add(rate)
    db.commit()
    db.refresh(rate)
    return rate


@router.put("/{rate_id}", response_model=RateOut)
def update_rate(rate_id: uuid.UUID, body: RateUpdate, user: AdminOnly, db: DB):
    rate = _get(rate_id, db)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(rate, k, v)
    db.commit()
    db.refresh(rate)
    return rate


@router.delete("/{rate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rate(rate_id: uuid.UUID, user: AdminOnly, db: DB):
    db.delete(_get(rate_id, db))
    db.commit()


def _get(rate_id: uuid.UUID, db) -> Rate:
    r = db.query(Rate).filter(Rate.id == rate_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Rate not found")
    return r
