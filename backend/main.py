from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
from routers import notes, ingest, retrieval

app = FastAPI(title="Second Brain API", version="0.1.0", redirect_slashes=False)

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


@app.get("/health")
async def health():
    return {"status": "ok"}
