"""initial

Revision ID: 0001
Revises:
Create Date: 2026-05-21 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.Enum("Admin", "Manager", "Consultant", name="user_role"), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )

    op.create_table(
        "clients",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("billing_email", sa.String(255), nullable=True),
        sa.Column("terms", sa.String(50), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "invoices",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("number"),
    )

    op.create_table(
        "time_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("hours", sa.Numeric(8, 2), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("draft", "pending", "approved", "rejected", "invoiced", name="entry_status"),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "rates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("rate", sa.Numeric(10, 2), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_name", sa.String(255), nullable=True),
        sa.Column("rounding_minutes", sa.Integer(), nullable=False, server_default="6"),
        sa.Column("week_ending", sa.String(20), nullable=False, server_default="Sunday"),
        sa.Column("timezone", sa.String(60), nullable=False, server_default="America/New_York"),
        sa.Column("currency", sa.String(10), nullable=False, server_default="USD"),
        sa.Column("logo_url", sa.Text(), nullable=True),
        sa.Column("payment_notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
    op.drop_table("rates")
    op.drop_table("time_entries")
    op.drop_table("invoices")
    op.drop_table("clients")
    op.drop_table("users")
    op.execute("DROP TYPE IF EXISTS entry_status")
    op.execute("DROP TYPE IF EXISTS user_role")
