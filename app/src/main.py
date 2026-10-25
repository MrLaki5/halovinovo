from contextlib import asynccontextmanager
from pathlib import Path

import admin_api
import guest_api
from config import settings
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from orm.database import dispose_engine, run_migrations
from starlette.middleware.sessions import SessionMiddleware

STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(_app):
    # Startup
    logger.info("Starting service...")
    await run_migrations()
    logger.info("Database migrations applied. Service ready.")

    yield

    # Shutdown
    logger.info("Shutting down service...")
    await dispose_engine()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SESSION_SECRET_KEY,
    max_age=settings.SESSION_TTL_HOURS * 3600,
    https_only=True,
    same_site="lax",
)

app.include_router(guest_api.router)
app.include_router(admin_api.auth_router)
app.include_router(admin_api.router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def page(name: str) -> FileResponse:
    # Revalidate every load, so guests never keep a stale page across deploys
    return FileResponse(STATIC_DIR / name, headers={"Cache-Control": "no-cache"})


def host_page(request: Request, name: str):
    if not admin_api.is_admin(request):
        return RedirectResponse("/admin/login", status_code=303)
    return page(name)


@app.get("/", include_in_schema=False)
async def guest_page():
    return page("index.html")


@app.get("/admin/login", include_in_schema=False)
async def login_page(request: Request):
    if admin_api.is_admin(request):
        return RedirectResponse("/admin", status_code=303)
    return page("admin/login.html")


@app.get("/admin", include_in_schema=False)
async def checkin_page(request: Request):
    return host_page(request, "admin/checkin.html")


@app.get("/admin/settings", include_in_schema=False)
async def settings_page(request: Request):
    return host_page(request, "admin/settings.html")


@app.get("/admin/winners", include_in_schema=False)
async def winners_page(request: Request):
    return host_page(request, "admin/winners.html")
