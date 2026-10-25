"""Guest endpoints. Guests have no account, just an anonymous voter id in a cookie."""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from orm import crud
from orm.database import get_db
from orm.models import Mask
from schema import GuestState
from sqlalchemy.ext.asyncio import AsyncSession
from state import build_guest_state

VOTER_COOKIE = "voter_id"
VOTER_COOKIE_MAX_AGE = 365 * 24 * 3600

router = APIRouter(prefix="/api", tags=["guest"])


def read_voter_id(request: Request) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(request.cookies.get(VOTER_COOKIE, ""))
    except ValueError:
        return None


def require_voter(request: Request) -> uuid.UUID:
    voter_id = read_voter_id(request)
    if voter_id is None:
        raise HTTPException(status_code=400, detail="Reload the page and try again")
    return voter_id


async def open_ballot(db: AsyncSession, voter_id: uuid.UUID):
    """Lock the voter for this request and check votes can still change."""
    await crud.close_voting_if_due(db)
    # A share lock holds off "End voting now" until this vote is in
    contest = await crud.get_contest(db, lock="share")
    if contest.phase != "voting":
        raise HTTPException(status_code=409, detail="Voting is closed")

    voter = await crud.lock_voter(db, voter_id)
    if voter.locked_at is not None:
        raise HTTPException(status_code=409, detail="Your votes are already locked in")
    return contest, voter


@router.get("/state", response_model=GuestState)
async def get_state(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    """Everything the guest screen needs. Polled every few seconds; issues the voter cookie."""
    voter_id = read_voter_id(request)
    if voter_id is None:
        voter_id = uuid.uuid4()
        response.set_cookie(
            VOTER_COOKIE,
            str(voter_id),
            max_age=VOTER_COOKIE_MAX_AGE,
            httponly=True,
            secure=True,
            samesite="lax",
        )

    await crud.close_voting_if_due(db)
    await db.commit()
    return await build_guest_state(db, voter_id)


@router.post("/votes/{mask_id}", response_model=GuestState)
async def cast_vote(
    mask_id: int,
    voter_id: uuid.UUID = Depends(require_voter),
    db: AsyncSession = Depends(get_db),
):
    contest, _ = await open_ballot(db, voter_id)

    if await db.get(Mask, mask_id) is None:
        raise HTTPException(status_code=404, detail="That mask is no longer in the gallery")

    mine = await crud.voter_mask_ids(db, voter_id)
    if mask_id not in mine:
        if len(mine) >= contest.votes_per_guest:
            raise HTTPException(status_code=409, detail="You're out of votes")
        await crud.add_vote(db, voter_id=voter_id, mask_id=mask_id)

    await db.commit()
    return await build_guest_state(db, voter_id)


@router.delete("/votes/{mask_id}", response_model=GuestState)
async def withdraw_vote(
    mask_id: int,
    voter_id: uuid.UUID = Depends(require_voter),
    db: AsyncSession = Depends(get_db),
):
    await open_ballot(db, voter_id)
    await crud.remove_vote(db, voter_id=voter_id, mask_id=mask_id)
    await db.commit()
    return await build_guest_state(db, voter_id)


@router.post("/lock", response_model=GuestState)
async def lock_votes(
    voter_id: uuid.UUID = Depends(require_voter),
    db: AsyncSession = Depends(get_db),
):
    """Make the guest's picks final."""
    _, voter = await open_ballot(db, voter_id)
    if not await crud.voter_mask_ids(db, voter_id):
        raise HTTPException(status_code=409, detail="Pick at least one mask first")

    voter.locked_at = datetime.now(timezone.utc)
    await db.commit()
    return await build_guest_state(db, voter_id)
