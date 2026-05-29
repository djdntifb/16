from fastapi import APIRouter

from ..deps import AdminOnly, CurrentUser, DB
from ..models import AppSettings
from ..schemas import SettingsOut, SettingsUpdate

router = APIRouter(prefix="/settings", tags=["settings"])


def _get_or_create(db) -> AppSettings:
    s = db.query(AppSettings).filter(AppSettings.id == 1).first()
    if not s:
        s = AppSettings(id=1)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


@router.get("", response_model=SettingsOut)
def get_settings(user: CurrentUser, db: DB):
    return _get_or_create(db)


@router.put("", response_model=SettingsOut)
def update_settings(body: SettingsUpdate, user: AdminOnly, db: DB):
    s = _get_or_create(db)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return s
