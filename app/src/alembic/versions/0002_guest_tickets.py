"""Guest tickets: votes belong to a checked-in mask instead of an anonymous cookie

Anonymous votes can't be mapped to a guest, so existing votes are dropped.

Revision ID: 0002_guest_tickets
Revises: 0001_initial_schema
Create Date: 2026-10-25 15:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_guest_tickets"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("votes")
    op.drop_table("voters")

    op.add_column("masks", sa.Column("ticket", sa.String(length=43), nullable=True))
    op.execute("UPDATE masks SET ticket = replace(gen_random_uuid()::text, '-', '')")
    op.alter_column("masks", "ticket", nullable=False)
    op.create_unique_constraint("uq_masks_ticket", "masks", ["ticket"])
    op.add_column("masks", sa.Column("session", sa.String(length=64), nullable=True))
    op.create_unique_constraint("uq_masks_session", "masks", ["session"])
    op.add_column("masks", sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "votes",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("mask_id", sa.Integer(), nullable=False),
        sa.Column("voter_mask_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["mask_id"], ["masks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["voter_mask_id"], ["masks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mask_id", "voter_mask_id", name="uq_votes_mask_voter"),
    )
    op.create_index("ix_votes_voter_mask_id", "votes", ["voter_mask_id"])


def downgrade() -> None:
    op.drop_table("votes")
    op.drop_column("masks", "locked_at")
    op.drop_constraint("uq_masks_session", "masks")
    op.drop_column("masks", "session")
    op.drop_constraint("uq_masks_ticket", "masks")
    op.drop_column("masks", "ticket")

    op.create_table(
        "voters",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "votes",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("mask_id", sa.Integer(), nullable=False),
        sa.Column("voter_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["mask_id"], ["masks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["voter_id"], ["voters.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mask_id", "voter_id", name="uq_votes_mask_voter"),
    )
    op.create_index("ix_votes_voter_id", "votes", ["voter_id"])
