"""Name-only voters: guests without a costume get a ticket but no photo or number

Revision ID: 0003_name_only_voters
Revises: 0002_guest_tickets
Create Date: 2026-10-31 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_name_only_voters"
down_revision: Union[str, None] = "0002_guest_tickets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("masks", "number", nullable=True)
    op.alter_column("masks", "photo", nullable=True)
    op.create_check_constraint(
        "ck_masks_photo_or_name",
        "masks",
        "(photo IS NULL) = (number IS NULL) AND (photo IS NOT NULL OR label IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_masks_photo_or_name", "masks")
    # Their votes cascade
    op.execute("DELETE FROM masks WHERE photo IS NULL")
    op.alter_column("masks", "photo", nullable=False)
    op.alter_column("masks", "number", nullable=False)
