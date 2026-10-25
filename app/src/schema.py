from datetime import datetime, timezone
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

Phase = Literal["checkin", "voting", "final", "winners"]


class LoginRequest(BaseModel):
    username: str
    password: str


class MaskOut(BaseModel):
    """A mask as guests see it: no label, and votes only when counts are shown."""

    id: int
    number: int
    photo_url: str
    votes: Optional[int] = None


class AdminMaskOut(MaskOut):
    label: Optional[str] = None
    votes: int


class WinnerOut(BaseModel):
    place: int
    name: str
    costume_title: Optional[str] = None
    mask: MaskOut


class ContestOut(BaseModel):
    party_name: str
    phase: Phase
    voting_closes_at: Optional[datetime] = None
    server_now: datetime
    finalist_count: int
    votes_per_guest: int
    show_vote_counts: bool


class GuestState(ContestOut):
    masks: List[MaskOut]
    finalists: List[MaskOut]
    winners: List[WinnerOut]
    my_votes: List[int]
    locked: bool


class AdminState(ContestOut):
    masks: List[AdminMaskOut]
    finalists: List[AdminMaskOut]
    winners: List[WinnerOut]
    next_mask_number: int
    voters_count: int


class SettingsUpdate(BaseModel):
    party_name: str = Field(min_length=1, max_length=40)
    voting_closes_at: Optional[datetime] = None
    finalist_count: int = Field(ge=2, le=10)
    votes_per_guest: int = Field(ge=1, le=5)
    show_vote_counts: bool

    @field_validator("party_name", mode="before")
    @classmethod
    def strip_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("voting_closes_at")
    @classmethod
    def assume_utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


class WinnerIn(BaseModel):
    place: int = Field(ge=1, le=3)
    mask_id: int
    name: str = Field(min_length=1, max_length=60)
    costume_title: Optional[str] = Field(default=None, max_length=80)

    @field_validator("name", "costume_title", mode="before")
    @classmethod
    def strip_text(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value


class WinnersUpdate(BaseModel):
    winners: List[WinnerIn] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def check_podium(self) -> "WinnersUpdate":
        places = [w.place for w in self.winners]
        if 1 not in places:
            raise ValueError("1st place is required")
        if len(set(places)) != len(places):
            raise ValueError("Each place can only be given once")
        masks = [w.mask_id for w in self.winners]
        if len(set(masks)) != len(masks):
            raise ValueError("Each mask can only win one place")
        return self
