import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Query

from ..deps import CurrentUser, DB
from ..models import Rate, TimeEntry
from ..schemas import ReportResponse, ReportSummary, TimeEntryOut

router = APIRouter(prefix="/reports", tags=["reports"])


def _get_rate(db, user_id: uuid.UUID, client_id: uuid.UUID) -> Decimal:
    from ..models import Rate
    rate = (
        db.query(Rate)
        .filter(Rate.user_id == user_id, Rate.client_id == client_id)
        .order_by(Rate.effective_from.desc().nullslast())
        .first()
    )
    return rate.rate if rate else Decimal("0")


@router.get("", response_model=ReportResponse)
def get_report(
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

    entries = q.order_by(TimeEntry.date.desc()).all()

    total_hours = sum(e.hours for e in entries)
    approved_hours = sum(e.hours for e in entries if e.status in ("approved", "invoiced"))
    billable = sum(
        e.hours * _get_rate(db, e.user_id, e.client_id)
        for e in entries if e.status in ("approved", "invoiced")
    )

    return {
        "summary": ReportSummary(
            total_hours=total_hours,
            approved_hours=approved_hours,
            billable_amount=billable,
            entry_count=len(entries),
        ),
        "entries": entries,
    }
