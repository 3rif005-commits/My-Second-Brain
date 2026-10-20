"""Slim entrypoint — notes and the databases engine only, for small hosts.

`main.py` mounts every router, and `routers/ingest.py` pulls in pymupdf and
trafilatura at import time, so the full app cannot install without them. The
slim app keeps `/db` (the databases engine, which imports nothing heavier
than asyncpg) and the notes routes; note CRUD in the browser goes straight
to Supabase from Next.js.

Use this only if the full build fails or times out on the host. On Render,
set two env vars on the service (render.yaml reads both):

    APP_MODULE=main_slim
    REQUIREMENTS_FILE=requirements-slim.txt

Notes and databases behave identically; ingest, retrieval, the agent engine
and the MCP client are simply absent.
"""
import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from routers import databases, notes
from services.db.connection import close_pool
from services.db.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)-20s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Same posture as main.py: a tick that cannot reach the database logs and
    # retries rather than failing startup.
    start_scheduler()
    yield
    stop_scheduler()
    await close_pool()


app = FastAPI(
    title="Second Brain API (slim)",
    version="0.2.0",
    redirect_slashes=False,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(notes.router)
app.include_router(databases.router)


@app.get("/health")
async def health():
    return {"status": "ok", "app": "slim"}
