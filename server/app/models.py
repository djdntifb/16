import uuid
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (
    Boolean, Date, DateTime, Enum, ForeignKey,
    Integer, Numeric, String, Text, Time, func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(Enum("Admin", "Manager", "Consultant", name="user_role"), nullable=False)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    entries: Mapped[list["TimeEntry"]] = relationship(back_populates="user")


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    billing_email: Mapped[str | None] = mapped_column(String(255))
    terms: Mapped[str | None] = mapped_column(String(50))
    address: Mapped[str | None] = mapped_column(Text)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    entries: Mapped[list["TimeEntry"]] = relationship(back_populates="client")
    rates: Mapped[list["Rate"]] = relationship(back_populates="client")


class Rate(Base):
    __tablename__ = "rates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id"), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    effective_from: Mapped[date | None] = mapped_column(Date)

    user: Mapped["User"] = relationship()
    client: Mapped["Client"] = relationship(back_populates="rates")


class TimeEntry(Base):
    __tablename__ = "time_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    hours: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Enum("draft", "pending", "approved", "rejected", "invoiced", name="entry_status"),
        default="draft",
        nullable=False,
    )
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("invoices.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship(back_populates="entries")
    client: Mapped["Client"] = relationship(back_populates="entries")
    invoice: Mapped["Invoice | None"] = relationship(back_populates="entries")


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    number: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    client_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clients.id"), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    client: Mapped["Client"] = relationship()
    creator: Mapped["User"] = relationship()
    entries: Mapped[list["TimeEntry"]] = relationship(back_populates="invoice")


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    company_name: Mapped[str | None] = mapped_column(String(255))
    rounding_minutes: Mapped[int] = mapped_column(Integer, default=6)
    week_ending: Mapped[str] = mapped_column(String(20), default="Sunday")
    timezone: Mapped[str] = mapped_column(String(60), default="America/New_York")
    currency: Mapped[str] = mapped_column(String(10), default="USD")
    logo_url: Mapped[str | None] = mapped_column(Text)
    payment_notes: Mapped[str | None] = mapped_column(Text)
