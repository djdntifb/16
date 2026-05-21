import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, EmailStr


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


# ── Users ─────────────────────────────────────────────────────────────────────

class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    email: str
    role: str
    created_at: datetime


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Literal["Admin", "Manager", "Consultant"]


class UserUpdate(BaseModel):
    name: str | None = None
    role: Literal["Admin", "Manager", "Consultant"] | None = None
    password: str | None = None


# ── Clients ───────────────────────────────────────────────────────────────────

class ClientOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    billing_email: str | None
    terms: str | None
    address: str | None


class ClientCreate(BaseModel):
    name: str
    billing_email: str | None = None
    terms: str | None = None
    address: str | None = None


class ClientUpdate(ClientCreate):
    name: str | None = None


# ── Rates ─────────────────────────────────────────────────────────────────────

class RateOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    user_id: uuid.UUID
    client_id: uuid.UUID
    rate: Decimal
    effective_from: date | None
    user: UserOut
    client: ClientOut


class RateCreate(BaseModel):
    user_id: uuid.UUID
    client_id: uuid.UUID
    rate: Decimal
    effective_from: date | None = None


class RateUpdate(BaseModel):
    rate: Decimal | None = None
    effective_from: date | None = None


# ── Time Entries ──────────────────────────────────────────────────────────────

class TimeEntryOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    user_id: uuid.UUID
    client_id: uuid.UUID
    date: date
    start_time: time
    end_time: time
    hours: Decimal
    description: str
    status: str
    invoice_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    user: UserOut
    client: ClientOut


class TimeEntryCreate(BaseModel):
    client_id: uuid.UUID
    date: date
    start_time: time
    end_time: time
    description: str


class TimeEntryUpdate(BaseModel):
    client_id: uuid.UUID | None = None
    date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    description: str | None = None


# ── Invoices ──────────────────────────────────────────────────────────────────

class InvoiceOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    number: int
    client_id: uuid.UUID
    period_start: date
    period_end: date
    total_amount: Decimal
    created_at: datetime
    client: ClientOut
    creator: UserOut


class InvoicePreviewRequest(BaseModel):
    client_id: uuid.UUID
    period_start: date
    period_end: date


class InvoiceFinalizeRequest(BaseModel):
    client_id: uuid.UUID
    period_start: date
    period_end: date


class InvoicePreviewResponse(BaseModel):
    entry_count: int
    total_amount: Decimal
    entries: list[TimeEntryOut]


# ── Reports ───────────────────────────────────────────────────────────────────

class ReportSummary(BaseModel):
    total_hours: Decimal
    approved_hours: Decimal
    billable_amount: Decimal
    entry_count: int


class ReportResponse(BaseModel):
    summary: ReportSummary
    entries: list[TimeEntryOut]


# ── Settings ──────────────────────────────────────────────────────────────────

class SettingsOut(BaseModel):
    model_config = {"from_attributes": True}

    company_name: str | None
    rounding_minutes: int
    week_ending: str
    timezone: str
    currency: str
    logo_url: str | None
    payment_notes: str | None


class SettingsUpdate(BaseModel):
    company_name: str | None = None
    rounding_minutes: int | None = None
    week_ending: str | None = None
    timezone: str | None = None
    currency: str | None = None
    logo_url: str | None = None
    payment_notes: str | None = None
