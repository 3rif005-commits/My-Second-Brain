import logging
import sys
import time
import uuid
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
from routers import notes, ingest, retrieval, internal, agent, agent_inline, agent_ingest

# ── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)-20s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

app = FastAPI(title="Second Brain API", version="0.2.0", redirect_slashes=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(notes.router)
app.include_router(ingest.router)
app.include_router(retrieval.router)
app.include_router(agent.router)
app.include_router(agent_inline.router)
app.include_router(agent_ingest.router)
app.include_router(internal.router)


@app.middleware("http")
async def request_logger(request: Request, call_next):
    request_id = str(uuid.uuid4())[:8]
    request.state.request_id = request_id
    start = time.perf_counter()
    response = await call_next(request)
    ms = int((time.perf_counter() - start) * 1000)
    logging.getLogger("http").info(
        f"rid={request_id} | {request.method} {request.url.path} → {response.status_code} | {ms}ms"
    )
    return response


@app.get("/health")
async def health():
    return {"status": "ok"}
