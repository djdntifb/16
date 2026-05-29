import uuid
from decimal import Decimal

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func

from ..deps import AdminOnly, DB
from ..models import Invoice, Rate, TimeEntry
from ..schemas import (
    InvoiceFinalizeRequest,
    InvoiceOut,
    InvoicePreviewRequest,
    InvoicePreviewResponse,
    TimeEntryOut,
)

router = APIRouter(prefix="/invoices", tags=["invoices"])


def _get_rate(db, user_id: uuid.UUID, client_id: uuid.UUID) -> Decimal:
    rate = (
        db.query(Rate)
        .filter(Rate.user_id == user_id, Rate.client_id == client_id)
        .order_by(Rate.effective_from.desc().nullslast())
        .first()
    )
    return rate.rate if rate else Decimal("0")


def _approved_entries(db, client_id: uuid.UUID, period_start, period_end) -> list[TimeEntry]:
    return (
        db.query(TimeEntry)
        .filter(
            TimeEntry.client_id == client_id,
            TimeEntry.status == "approved",
            TimeEntry.date >= period_start,
            TimeEntry.date <= period_end,
        )
        .order_by(TimeEntry.date, TimeEntry.start_time)
        .all()
    )


@router.get("", response_model=list[InvoiceOut])
def list_invoices(user: AdminOnly, db: DB):
    return db.query(Invoice).order_by(Invoice.number.desc()).all()


@router.post("/preview", response_model=InvoicePreviewResponse)
def preview_invoice(body: InvoicePreviewRequest, user: AdminOnly, db: DB):
    entries = _approved_entries(db, body.client_id, body.period_start, body.period_end)
    if not entries:
        raise HTTPException(status_code=404, detail="No approved entries for this client and period")
    total = sum(e.hours * _get_rate(db, e.user_id, e.client_id) for e in entries)
    return {"entry_count": len(entries), "total_amount": total, "entries": entries}


@router.post("/finalize", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
def finalize_invoice(body: InvoiceFinalizeRequest, user: AdminOnly, db: DB):
    entries = _approved_entries(db, body.client_id, body.period_start, body.period_end)
    if not entries:
        raise HTTPException(status_code=404, detail="No approved entries to invoice")

    next_num = (db.query(func.max(Invoice.number)).scalar() or 1000) + 1
    total = sum(e.hours * _get_rate(db, e.user_id, e.client_id) for e in entries)

    invoice = Invoice(
        number=next_num,
        client_id=body.client_id,
        period_start=body.period_start,
        period_end=body.period_end,
        total_amount=total,
        created_by=user.id,
    )
    db.add(invoice)
    db.flush()

    for e in entries:
        e.status = "invoiced"
        e.invoice_id = invoice.id

    db.commit()
    db.refresh(invoice)
    return invoice
