"""Host endpoints. The one host account comes from ADMIN_USERNAME / ADMIN_PASSWORD."""

import secrets
from datetime import datetime, timezone
from typing import Optional

import qrcode
import qrcode.image.svg
from config import settings
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from loguru import logger
from orm import crud
from orm.database import get_db
from orm.models import Mask
from photos import delete_photos, detect_extension, save_photo
from schema import AdminState, LoginRequest, SettingsUpdate, WinnersUpdate
from sqlalchemy.ext.asyncio import AsyncSession
from state import build_admin_state


def is_admin(request: Request) -> bool:
    return bool(request.session.get("admin"))


async def require_admin(request: Request) -> None:
    if not is_admin(request):
        raise HTTPException(status_code=401, detail="Sign in as the host")


auth_router = APIRouter(prefix="/api/admin", tags=["admin"])
router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@auth_router.post("/login")
async def login(request: Request, req: LoginRequest):
    # Both compared, in constant time, so a wrong username takes as long as a wrong password
    username_ok = secrets.compare_digest(req.username.encode(), settings.ADMIN_USERNAME.encode())
    password_ok = secrets.compare_digest(req.password.encode(), settings.ADMIN_PASSWORD.encode())
    if not (username_ok and password_ok):
        logger.warning("Failed host login")
        raise HTTPException(status_code=401, detail="Wrong username or password")

    request.session["admin"] = True
    return {"success": True}


@auth_router.post("/logout")
async def logout(request: Request):
    request.session.clear()
    return {"success": True}


@router.get("/state", response_model=AdminState)
async def get_state(db: AsyncSession = Depends(get_db)):
    await crud.close_voting_if_due(db)
    await db.commit()
    return await build_admin_state(db)


@router.post("/masks", response_model=AdminState)
async def add_mask(
    photo: UploadFile = File(...),
    label: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    data = await photo.read(settings.MAX_UPLOAD_BYTES + 1)
    if len(data) > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Photo is too large")
    extension = detect_extension(data)
    if extension is None:
        raise HTTPException(status_code=415, detail="Upload a JPEG, PNG or WebP photo")

    label = (label or "").strip()[:80] or None
    name = save_photo(data, extension)
    try:
        await crud.create_mask(db, photo=name, label=label)
        await db.commit()
    except Exception:
        delete_photos([name])
        raise

    return await build_admin_state(db)


@router.delete("/masks/{mask_id}", response_model=AdminState)
async def remove_mask(mask_id: int, db: AsyncSession = Depends(get_db)):
    mask = await crud.delete_mask(db, mask_id)
    if mask is None:
        raise HTTPException(status_code=404, detail="Mask not found")
    await db.commit()
    delete_photos([mask.photo])
    return await build_admin_state(db)


async def find_mask(db: AsyncSession, mask_id: int) -> Mask:
    mask = await db.get(Mask, mask_id, populate_existing=True)
    if mask is None:
        raise HTTPException(status_code=404, detail="Mask not found")
    return mask


@router.get("/masks/{mask_id}/qr.svg")
async def ticket_qr(mask_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    """The guest's ticket as a QR code, pointing at whatever address the host is using."""
    mask = await find_mask(db, mask_id)
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    url = f"{scheme}://{request.headers['host']}/?ticket={mask.ticket}"
    svg = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, border=0).to_string()
    return Response(svg, media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


@router.post("/masks/{mask_id}/ticket", response_model=AdminState)
async def reissue_ticket(mask_id: int, db: AsyncSession = Depends(get_db)):
    """Replace a guest's ticket. The phone holding the old one stops voting; votes stay."""
    mask = await find_mask(db, mask_id)
    mask.ticket = crud.new_ticket()
    mask.session = None
    await db.commit()
    return await build_admin_state(db)


@router.put("/settings", response_model=AdminState)
async def save_settings(req: SettingsUpdate, db: AsyncSession = Depends(get_db)):
    """Save the config. A future close time opens voting from check-in, or reopens it from final."""
    await crud.close_voting_if_due(db)
    contest = await crud.get_contest(db, lock="update")
    now = datetime.now(timezone.utc)
    closes_at = req.voting_closes_at
    in_future = closes_at is not None and closes_at > now

    if contest.phase in ("checkin", "voting") and closes_at is not None and not in_future:
        raise HTTPException(status_code=422, detail="Pick a closing time in the future")

    contest.party_name = req.party_name
    contest.voting_closes_at = closes_at
    contest.finalist_count = req.finalist_count
    contest.votes_per_guest = req.votes_per_guest
    contest.show_vote_counts = req.show_vote_counts
    if in_future and contest.phase in ("checkin", "final"):
        contest.phase = "voting"

    await db.commit()
    return await build_admin_state(db)


@router.post("/end-voting", response_model=AdminState)
async def end_voting(db: AsyncSession = Depends(get_db)):
    contest = await crud.get_contest(db, lock="update")
    if contest.phase != "voting":
        raise HTTPException(status_code=409, detail="Voting isn't open")

    contest.phase = "final"
    contest.voting_closes_at = datetime.now(timezone.utc)
    await db.commit()
    return await build_admin_state(db)


@router.put("/winners", response_model=AdminState)
async def publish_winners(req: WinnersUpdate, db: AsyncSession = Depends(get_db)):
    """Store the podium and show it to every guest. Can be re-published to fix a typo."""
    await crud.close_voting_if_due(db)
    contest = await crud.get_contest(db, lock="update")
    if contest.phase not in ("final", "winners"):
        raise HTTPException(status_code=409, detail="End voting before announcing winners")

    finalist_ids = {
        m.id
        for m in crud.pick_finalists(
            await crud.list_masks(db), await crud.vote_counts(db), contest.finalist_count
        )
    }
    if any(w.mask_id not in finalist_ids for w in req.winners):
        raise HTTPException(status_code=422, detail="Winners must be picked from the finalists")

    await crud.replace_winners(db, [w.model_dump() for w in req.winners])
    contest.phase = "winners"
    await db.commit()
    return await build_admin_state(db)


@router.post("/reset", response_model=AdminState)
async def reset(db: AsyncSession = Depends(get_db)):
    """Delete every mask, photo, vote and winner, and restore default settings."""
    await crud.get_contest(db, lock="update")
    photos = await crud.reset_contest(db)
    await db.commit()
    delete_photos(photos)
    logger.info(f"Tournament reset, {len(photos)} photos deleted")
    return await build_admin_state(db)
