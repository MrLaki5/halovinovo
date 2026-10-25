"""Initial schema baseline

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-10-25 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "contest_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("party_name", sa.String(length=40), server_default="Halovinovo", nullable=False),
        sa.Column("phase", sa.String(length=16), server_default="checkin", nullable=False),
        sa.Column("voting_closes_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finalist_count", sa.Integer(), server_default="5", nullable=False),
        sa.Column("votes_per_guest", sa.Integer(), server_default="3", nullable=False),
        sa.Column("show_vote_counts", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("next_mask_number", sa.Integer(), server_default="1", nullable=False),
        sa.CheckConstraint("id = 1", name="ck_contest_settings_single_row"),
        sa.CheckConstraint(
            "phase IN ('checkin', 'voting', 'final', 'winners')",
            name="ck_contest_settings_phase",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute("INSERT INTO contest_settings (id) VALUES (1)")

    op.create_table(
        "masks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("photo", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("number"),
    )

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

    op.create_table(
        "winners",
        sa.Column("place", sa.Integer(), nullable=False),
        sa.Column("mask_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("costume_title", sa.String(length=80), nullable=True),
        sa.CheckConstraint("place BETWEEN 1 AND 3", name="ck_winners_place"),
        sa.ForeignKeyConstraint(["mask_id"], ["masks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("place"),
        sa.UniqueConstraint("mask_id"),
    )


def downgrade() -> None:
    # Indexes go with their tables
    op.drop_table("winners")
    op.drop_table("votes")
    op.drop_table("voters")
    op.drop_table("masks")
    op.drop_table("contest_settings")
