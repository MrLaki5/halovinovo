"""Guest endpoints. A phone votes once it claims the ticket QR its guest got at check-in."""

import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from orm import crud
from orm.database import get_db
from orm.models import Mask
from schema import ClaimRequest, GuestState
from sqlalchemy.ext.asyncio import AsyncSession
from state import build_guest_state

SESSION_COOKIE = "voter_session"
SESSION_COOKIE_MAX_AGE = 30 * 24 * 3600

router = APIRouter(prefix="/api", tags=["guest"])


def read_session(request: Request) -> Optional[str]:
    value = request.cookies.get(SESSION_COOKIE)
    return value if value and len(value) <= 64 else None


async def open_ballot(db: AsyncSession, request: Request):
    """Lock the guest for this request and check their votes can still change."""
    await crud.close_voting_if_due(db)
    # A share lock holds off "End voting now" until this vote is in
    contest = await crud.get_contest(db, lock="share")
    if contest.phase != "voting":
        raise HTTPException(status_code=409, detail="Voting is closed")

    session = read_session(request)
    me = await crud.get_mask_by_session(db, session, lock=True) if session else None
    if me is None:
        raise HTTPException(status_code=403, detail="Scan your check-in QR code to vote")
    if me.locked_at is not None:
        raise HTTPException(status_code=409, detail="Your votes are already locked in")
    return contest, me


@router.get("/state", response_model=GuestState)
async def get_state(request: Request, db: AsyncSession = Depends(get_db)):
    """Everything the guest screen needs. Polled every few seconds."""
    await crud.close_voting_if_due(db)
    await db.commit()
    return await build_guest_state(db, read_session(request))


@router.post("/claim", response_model=GuestState)
async def claim_ticket(
    req: ClaimRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Bind this phone to a guest. Each ticket works on one phone only."""
    mask = await crud.get_mask_by_ticket(db, req.ticket, lock=True)
    if mask is None:
        raise HTTPException(
            status_code=404, detail="This code no longer works. Ask the host for a new one."
        )

    session = read_session(request)
    if mask.session is not None:
        if mask.session == session:
            return await build_guest_state(db, session)
        raise HTTPException(
            status_code=409,
            detail="This code was already used on another phone. Ask the host for a new one.",
        )

    current = await crud.get_mask_by_session(db, session) if session else None
    if current is not None:
        raise HTTPException(
            status_code=409, detail=f"This phone already votes as #{current.number:02d}."
        )

    mask.session = secrets.token_urlsafe(32)
    await db.commit()
    response.set_cookie(
        SESSION_COOKIE,
        mask.session,
        max_age=SESSION_COOKIE_MAX_AGE,
        httponly=True,
        secure=True,
        samesite="lax",
    )
    return await build_guest_state(db, mask.session)


@router.post("/votes/{mask_id}", response_model=GuestState)
async def cast_vote(mask_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    contest, me = await open_ballot(db, request)

    if mask_id == me.id:
        raise HTTPException(status_code=409, detail="You can't vote for your own mask")
    if await db.get(Mask, mask_id) is None:
        raise HTTPException(status_code=404, detail="That mask is no longer in the gallery")

    mine = await crud.voter_mask_ids(db, me.id)
    if mask_id not in mine:
        if len(mine) >= contest.votes_per_guest:
            raise HTTPException(status_code=409, detail="You're out of votes")
        await crud.add_vote(db, voter_mask_id=me.id, mask_id=mask_id)

    await db.commit()
    return await build_guest_state(db, me.session)


@router.delete("/votes/{mask_id}", response_model=GuestState)
async def withdraw_vote(mask_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    _, me = await open_ballot(db, request)
    await crud.remove_vote(db, voter_mask_id=me.id, mask_id=mask_id)
    await db.commit()
    return await build_guest_state(db, me.session)


@router.post("/lock", response_model=GuestState)
async def lock_votes(request: Request, db: AsyncSession = Depends(get_db)):
    """Make the guest's picks final."""
    _, me = await open_ballot(db, request)
    if not await crud.voter_mask_ids(db, me.id):
        raise HTTPException(status_code=409, detail="Pick at least one mask first")

    me.locked_at = datetime.now(timezone.utc)
    await db.commit()
    return await build_guest_state(db, me.session)
