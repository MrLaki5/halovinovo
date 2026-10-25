"""Contest tables.

`contest_settings` holds exactly one row: the party's config and its phase. A mask is a
checked-in guest: their costume photo plus the single-use ticket their phone votes with.
Votes link the voting guest's mask to the mask they picked, winners hold the podium.
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
    true,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

PHASES = ("checkin", "voting", "final", "winners")


class Base(DeclarativeBase):
    pass


class ContestSettings(Base):
    __tablename__ = "contest_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Server defaults are the single source of truth: reset re-inserts a bare row
    party_name: Mapped[str] = mapped_column(String(40), nullable=False, server_default="Halovinovo")
    phase: Mapped[str] = mapped_column(String(16), nullable=False, server_default="checkin")
    voting_closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finalist_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="5")
    votes_per_guest: Mapped[int] = mapped_column(Integer, nullable=False, server_default="3")
    show_vote_counts: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true())
    # A counter rather than max(number) + 1, so a deleted mask's number is never reused
    next_mask_number: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")

    __table_args__ = (
        CheckConstraint("id = 1", name="ck_contest_settings_single_row"),
        CheckConstraint(f"phase IN {PHASES}", name="ck_contest_settings_phase"),
    )


class Mask(Base):
    __tablename__ = "masks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    # File name under UPLOAD_DIR
    photo: Mapped[str] = mapped_column(String(64), nullable=False)
    # Host-only, never sent to guests
    label: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Code in the guest's check-in QR. Reissuing replaces it and drops the session.
    ticket: Mapped[str] = mapped_column(String(43), nullable=False, unique=True)
    # Cookie secret of the phone that claimed the ticket; null until claimed
    session: Mapped[str | None] = mapped_column(String(64), unique=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Vote(Base):
    __tablename__ = "votes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    mask_id: Mapped[int] = mapped_column(
        ForeignKey("masks.id", ondelete="CASCADE"), nullable=False
    )
    # The guest who voted, identified by their own mask
    voter_mask_id: Mapped[int] = mapped_column(
        ForeignKey("masks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("mask_id", "voter_mask_id", name="uq_votes_mask_voter"),
    )


class Winner(Base):
    __tablename__ = "winners"

    place: Mapped[int] = mapped_column(Integer, primary_key=True)
    mask_id: Mapped[int] = mapped_column(
        ForeignKey("masks.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    costume_title: Mapped[str | None] = mapped_column(String(80))

    __table_args__ = (CheckConstraint("place BETWEEN 1 AND 3", name="ck_winners_place"),)
