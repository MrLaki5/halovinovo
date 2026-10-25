"""Alembic environment, always pointed at settings.DATABASE_URL.

The app applies migrations on startup through orm.database.run_migrations, which hands
over a connection of its own. Run from the command line (`alembic ...` in app/src), a
short-lived engine is opened here instead.
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from config import settings
from orm.models import Base
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

config = context.config

# The app runs this in-process, so leave the loggers uvicorn already set up alone
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Print the migration SQL instead of running it (`alembic upgrade head --sql`)."""
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Open a throwaway engine and run the migrations on it."""
    engine = create_async_engine(settings.DATABASE_URL, poolclass=pool.NullPool)

    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await engine.dispose()


def run_migrations_online() -> None:
    # Set by orm.database.run_migrations, which is already inside a transaction
    connection = config.attributes.get("connection")
    if connection is not None:
        do_run_migrations(connection)
        return

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
