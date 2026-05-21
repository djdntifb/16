import uuid
from datetime import date

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import and_

from ..deps import AdminOrManager, CurrentUser, DB
from ..models import AppSettings, Rate, TimeEntry
from ..schemas import TimeEntryCreate, TimeEntryOut, TimeEntryUpdate

router = APIRouter(prefix="/entries", tags=["entries"])

EDITABLE = ("draft", "pending")


def _round_hours(raw: float, db) -> float:
    settings = db.query(AppSettings).filter(AppSettings.id == 1).first()
    step = (settings.rounding_minutes if settings else 6) / 60
    return round(raw / step) * step


def _check_overlap(db, user_id, entry_date, start_time, end_time, exclude_id=None) -> bool:
    q = db.query(TimeEntry).filter(
        TimeEntry.user_id == user_id,
        TimeEntry.date == entry_date,
        TimeEntry.start_time < end_time,
        TimeEntry.end_time > start_time,
        TimeEntry.status != "rejected",
    )
    if exclude_id:
        q = q.filter(TimeEntry.id != exclude_id)
    return q.first() is not None


@router.get("", response_model=list[TimeEntryOut])
def list_entries(
    user: CurrentUser, db: DB,
    period_start: date | None = Query(None),
    period_end: date | None = Query(None),
    client_id: uuid.UUID | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    user_id: uuid.UUID | None = Query(None),
):
    q = db.query(TimeEntry)
    if user.role == "Consultant":
        q = q.filter(TimeEntry.user_id == user.id)
    elif user_id:
        q = q.filter(TimeEntry.user_id == user_id)
    if period_start:
        q = q.filter(TimeEntry.date >= period_start)
    if period_end:
        q = q.filter(TimeEntry.date <= period_end)
    if client_id:
        q = q.filter(TimeEntry.client_id == client_id)
    if status_filter:
        q = q.filter(TimeEntry.status == status_filter)
    return q.order_by(TimeEntry.date.desc(), TimeEntry.start_time.desc()).all()


@router.post("", response_model=TimeEntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(body: TimeEntryCreate, user: CurrentUser, db: DB):
    if body.end_time <= body.start_time:
        raise HTTPException(status_code=400, detail="End time must be after start time")
    raw_hours = (body.end_time.hour * 60 + body.end_time.minute - body.start_time.hour * 60 - body.start_time.minute) / 60
    hours = _round_hours(raw_hours, db)
    entry = TimeEntry(
        user_id=user.id,
        client_id=body.client_id,
        date=body.date,
        start_time=body.start_time,
        end_time=body.end_time,
        hours=hours,
        description=body.description,
        status="draft",
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.put("/{entry_id}", response_model=TimeEntryOut)
def update_entry(entry_id: uuid.UUID, body: TimeEntryUpdate, user: CurrentUser, db: DB):
    entry = _get_own_editable(entry_id, user, db)
    if body.client_id is not None:
        entry.client_id = body.client_id
    if body.date is not None:
        entry.date = body.date
    if body.start_time is not None:
        entry.start_time = body.start_time
    if body.end_time is not None:
        entry.end_time = body.end_time
    if body.description is not None:
        entry.description = body.description
    if entry.end_time <= entry.start_time:
        raise HTTPException(status_code=400, detail="End time must be after start time")
    raw_hours = (entry.end_time.hour * 60 + entry.end_time.minute - entry.start_time.hour * 60 - entry.start_time.minute) / 60
    entry.hours = _round_hours(raw_hours, db)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: uuid.UUID, user: CurrentUser, db: DB):
    entry = _get_own_editable(entry_id, user, db)
    db.delete(entry)
    db.commit()


@router.post("/{entry_id}/submit", response_model=TimeEntryOut)
def submit_entry(entry_id: uuid.UUID, user: CurrentUser, db: DB):
    entry = _get_own_entry(entry_id, user, db)
    if entry.status != "draft":
        raise HTTPException(status_code=400, detail="Only draft entries can be submitted")
    entry.status = "pending"
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/submit-week", response_model=list[TimeEntryOut])
def submit_week(user: CurrentUser, db: DB, period_start: date = Query(...), period_end: date = Query(...)):
    entries = db.query(TimeEntry).filter(
        TimeEntry.user_id == user.id,
        TimeEntry.status == "draft",
        TimeEntry.date >= period_start,
        TimeEntry.date <= period_end,
    ).all()
    for e in entries:
        e.status = "pending"
    db.commit()
    return entries


@router.post("/{entry_id}/approve", response_model=TimeEntryOut)
def approve_entry(entry_id: uuid.UUID, user: AdminOrManager, db: DB):
    entry = _get_entry(entry_id, db)
    if entry.status != "pending":
        raise HTTPException(status_code=400, detail="Only pending entries can be approved")
    entry.status = "approved"
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/{entry_id}/reject", response_model=TimeEntryOut)
def reject_entry(entry_id: uuid.UUID, user: AdminOrManager, db: DB):
    entry = _get_entry(entry_id, db)
    if entry.status != "pending":
        raise HTTPException(status_code=400, detail="Only pending entries can be rejected")
    entry.status = "rejected"
    db.commit()
    db.refresh(entry)
    return entry


def _get_entry(entry_id: uuid.UUID, db) -> TimeEntry:
    entry = db.query(TimeEntry).filter(TimeEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


def _get_own_entry(entry_id: uuid.UUID, user, db) -> TimeEntry:
    entry = _get_entry(entry_id, db)
    if entry.user_id != user.id and user.role != "Admin":
        raise HTTPException(status_code=403, detail="Not your entry")
    return entry


def _get_own_editable(entry_id: uuid.UUID, user, db) -> TimeEntry:
    entry = _get_own_entry(entry_id, user, db)
    if entry.status not in EDITABLE:
        raise HTTPException(status_code=400, detail=f"Cannot modify a {entry.status} entry")
    return entry
