"""Async engine and session factory for the contest database."""

from pathlib import Path
from typing import AsyncGenerator

from alembic import command
from alembic.config import Config
from config import settings
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

ALEMBIC_INI = str(Path(__file__).resolve().parent.parent / "alembic.ini")

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker | None = None


def get_engine() -> AsyncEngine:
    """Return the process-wide engine, creating it on first use."""
    global _engine, _session_factory

    if _engine is None:
        _engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False)

    return _engine


def get_session_factory() -> async_sessionmaker:
    """Return the session factory bound to the engine."""
    get_engine()
    return _session_factory


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: one session per request."""
    session_factory = get_session_factory()
    async with session_factory() as session:
        yield session


def _upgrade_to_head(connection: Connection) -> None:
    """Apply every pending migration on the given connection."""
    alembic_cfg = Config(ALEMBIC_INI)
    alembic_cfg.attributes["connection"] = connection
    command.upgrade(alembic_cfg, "head")


async def run_migrations() -> None:
    """Bring the schema up to the latest Alembic revision.

    A no-op once the database is at head, which is what makes it safe on every startup.
    Schema changes belong in a new revision under alembic/versions, not here.
    """
    async with get_engine().begin() as conn:
        await conn.run_sync(_upgrade_to_head)


async def dispose_engine() -> None:
    """Close the connection pool."""
    global _engine, _session_factory

    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
