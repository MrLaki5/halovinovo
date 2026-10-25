"""Snapshots of the contest as guests and the host see them."""

import uuid
from datetime import datetime, timezone
from typing import Optional

from orm import crud
from orm.models import ContestSettings, Mask
from photos import photo_url
from schema import AdminMaskOut, AdminState, GuestState, MaskOut, WinnerOut
from sqlalchemy.ext.asyncio import AsyncSession


def contest_fields(contest: ContestSettings) -> dict:
    return {
        "party_name": contest.party_name,
        "phase": contest.phase,
        "voting_closes_at": contest.voting_closes_at,
        "server_now": datetime.now(timezone.utc),
        "finalist_count": contest.finalist_count,
        "votes_per_guest": contest.votes_per_guest,
        "show_vote_counts": contest.show_vote_counts,
    }


async def build_winners(db: AsyncSession) -> list[WinnerOut]:
    return [
        WinnerOut(
            place=winner.place,
            name=winner.name,
            costume_title=winner.costume_title,
            mask=MaskOut(id=mask.id, number=mask.number, photo_url=photo_url(mask.photo)),
        )
        for winner, mask in await crud.list_winners(db)
    ]


async def build_guest_state(db: AsyncSession, voter_id: Optional[uuid.UUID]) -> GuestState:
    contest = await crud.get_contest(db)
    masks = await crud.list_masks(db)
    counts = await crud.vote_counts(db)
    show_counts = contest.show_vote_counts and contest.phase != "checkin"

    def out(mask: Mask) -> MaskOut:
        return MaskOut(
            id=mask.id,
            number=mask.number,
            photo_url=photo_url(mask.photo),
            votes=counts.get(mask.id, 0) if show_counts else None,
        )

    voter = await crud.get_voter(db, voter_id) if voter_id else None
    finalists = (
        crud.pick_finalists(masks, counts, contest.finalist_count)
        if contest.phase in ("final", "winners")
        else []
    )

    return GuestState(
        **contest_fields(contest),
        masks=[out(m) for m in masks],
        finalists=[out(m) for m in finalists],
        winners=await build_winners(db) if contest.phase == "winners" else [],
        my_votes=await crud.voter_mask_ids(db, voter_id) if voter else [],
        locked=bool(voter and voter.locked_at),
    )


async def build_admin_state(db: AsyncSession) -> AdminState:
    contest = await crud.get_contest(db)
    masks = await crud.list_masks(db)
    counts = await crud.vote_counts(db)

    def out(mask: Mask) -> AdminMaskOut:
        return AdminMaskOut(
            id=mask.id,
            number=mask.number,
            photo_url=photo_url(mask.photo),
            label=mask.label,
            votes=counts.get(mask.id, 0),
        )

    finalists = (
        crud.pick_finalists(masks, counts, contest.finalist_count)
        if contest.phase in ("final", "winners")
        else []
    )

    return AdminState(
        **contest_fields(contest),
        masks=[out(m) for m in masks],
        finalists=[out(m) for m in finalists],
        winners=await build_winners(db),
        next_mask_number=contest.next_mask_number,
        voters_count=await crud.count_voters(db),
    )
