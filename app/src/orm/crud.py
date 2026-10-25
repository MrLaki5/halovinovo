"""Database operations for the contest.

Nothing here commits: the caller owns the transaction.
"""

import secrets
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import delete, distinct, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from .models import ContestSettings, Mask, Vote, Winner

# ---- contest settings -------------------------------------------------------


async def get_contest(db: AsyncSession, *, lock: Optional[str] = None) -> ContestSettings:
    """Fetch the settings row, optionally locked ("update" or "share")."""
    q = select(ContestSettings).where(ContestSettings.id == 1)
    if lock == "update":
        q = q.with_for_update()
    elif lock == "share":
        q = q.with_for_update(read=True)
    # populate_existing, or a row cached earlier in the session hides a concurrent change
    res = await db.execute(q.execution_options(populate_existing=True))
    return res.scalar_one()


async def close_voting_if_due(db: AsyncSession) -> None:
    """Move voting -> final once the close time has passed. Idempotent and race-free."""
    await db.execute(
        update(ContestSettings)
        .where(
            ContestSettings.id == 1,
            ContestSettings.phase == "voting",
            ContestSettings.voting_closes_at <= datetime.now(timezone.utc),
        )
        .values(phase="final")
    )


# ---- masks ------------------------------------------------------------------


async def list_masks(db: AsyncSession) -> List[Mask]:
    res = await db.execute(select(Mask).order_by(Mask.number))
    return list(res.scalars().all())


async def create_mask(db: AsyncSession, *, photo: str, label: Optional[str]) -> Mask:
    """Insert a mask under the next display number."""
    res = await db.execute(
        update(ContestSettings)
        .where(ContestSettings.id == 1)
        .values(next_mask_number=ContestSettings.next_mask_number + 1)
        .returning(ContestSettings.next_mask_number - 1)
    )
    mask = Mask(number=res.scalar_one(), photo=photo, label=label, ticket=new_ticket())
    db.add(mask)
    await db.flush()
    return mask


async def delete_mask(db: AsyncSession, mask_id: int) -> Optional[Mask]:
    """Delete a mask (its votes and podium place cascade), returning it if it existed."""
    mask = await db.get(Mask, mask_id)
    if mask is not None:
        await db.delete(mask)
        await db.flush()
    return mask


# ---- tickets ----------------------------------------------------------------


def new_ticket() -> str:
    return secrets.token_urlsafe(16)


async def _find_mask(db: AsyncSession, condition, lock: bool) -> Optional[Mask]:
    q = select(Mask).where(condition)
    if lock:
        # NO KEY UPDATE, so votes for this mask (FK checks) aren't blocked by the lock
        q = q.with_for_update(key_share=True)
    res = await db.execute(q.execution_options(populate_existing=True))
    return res.scalar_one_or_none()


async def get_mask_by_ticket(db: AsyncSession, ticket: str, *, lock: bool = False) -> Optional[Mask]:
    return await _find_mask(db, Mask.ticket == ticket, lock)


async def get_mask_by_session(
    db: AsyncSession, session: str, *, lock: bool = False
) -> Optional[Mask]:
    """The guest a phone votes as. Locking it serializes that guest's requests."""
    return await _find_mask(db, Mask.session == session, lock)


# ---- votes ------------------------------------------------------------------


async def vote_counts(db: AsyncSession) -> Dict[int, int]:
    res = await db.execute(select(Vote.mask_id, func.count()).group_by(Vote.mask_id))
    return dict(res.all())


async def count_voters(db: AsyncSession) -> int:
    """Guests with at least one vote."""
    res = await db.execute(select(func.count(distinct(Vote.voter_mask_id))))
    return res.scalar_one()


async def voter_mask_ids(db: AsyncSession, voter_mask_id: int) -> List[int]:
    """The masks a guest picked, in the order they picked them."""
    res = await db.execute(
        select(Vote.mask_id).where(Vote.voter_mask_id == voter_mask_id).order_by(Vote.id)
    )
    return list(res.scalars().all())


async def add_vote(db: AsyncSession, *, voter_mask_id: int, mask_id: int) -> None:
    await db.execute(
        pg_insert(Vote)
        .values(voter_mask_id=voter_mask_id, mask_id=mask_id)
        .on_conflict_do_nothing()
    )


async def remove_vote(db: AsyncSession, *, voter_mask_id: int, mask_id: int) -> None:
    await db.execute(
        delete(Vote).where(Vote.voter_mask_id == voter_mask_id, Vote.mask_id == mask_id)
    )


def pick_finalists(masks: Sequence[Mask], counts: Dict[int, int], n: int) -> List[Mask]:
    """Top n masks by votes. Masks tied at the cut-off all go through; zero votes never do."""
    ranked = sorted(
        (m for m in masks if counts.get(m.id, 0) > 0),
        key=lambda m: (-counts[m.id], m.number),
    )
    if len(ranked) <= n:
        return ranked
    cutoff = counts[ranked[n - 1].id]
    return [m for m in ranked if counts[m.id] >= cutoff]


# ---- winners ----------------------------------------------------------------


async def list_winners(db: AsyncSession) -> List[Tuple[Winner, Mask]]:
    res = await db.execute(
        select(Winner, Mask).join(Mask, Mask.id == Winner.mask_id).order_by(Winner.place)
    )
    return [(w, m) for w, m in res.all()]


async def replace_winners(db: AsyncSession, winners: Sequence[dict]) -> None:
    await db.execute(delete(Winner))
    if winners:
        await db.execute(insert(Winner), list(winners))


# ---- reset ------------------------------------------------------------------


async def reset_contest(db: AsyncSession) -> List[str]:
    """Wipe everything and restore default settings. Returns the photo files to delete."""
    res = await db.execute(select(Mask.photo))
    photos = list(res.scalars().all())

    # Winners, votes and guest sessions all go with the masks
    await db.execute(delete(Mask))
    await db.execute(delete(ContestSettings))
    await db.execute(insert(ContestSettings).values(id=1))
    return photos
