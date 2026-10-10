"""Where archives live, when they are made, and the scheduler's daily pass."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path

from . import archive, retention

log = logging.getLogger(__name__)


def backup_dir(setting: str = "") -> Path:
    return Path(setting).expanduser() if setting else Path.home() / "SecondBrainBackups"


def default_skill_dirs() -> list[Path]:
    from prompts._skill_text import SKILLS_DIR, USER_SKILLS_DIR
    return [USER_SKILLS_DIR, SKILLS_DIR]


def only_user(db) -> str:
    rows = db.table("profiles").select("id").execute().data or []
    if len(rows) != 1:
        raise SystemExit(f"{len(rows)} users found: pass --user")
    return str(rows[0]["id"])


def run_for_user(db, user_id: str, folder: Path, *, storage_download=None, skills_dirs=None, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    out = folder / str(user_id)[:8] / retention.archive_name(now)
    manifest = archive.build(db, user_id, out, storage_download=storage_download, skills_dirs=skills_dirs or [], now=now)
    bad = archive.verify(out)
    if bad:                                       # a backup that does not verify is not kept
        out.unlink(missing_ok=True)
        raise RuntimeError("the new backup failed its own check: " + "; ".join(bad[:3]))
    pruned = retention.prune(out.parent)
    return {"path": str(out), "bytes": out.stat().st_size, "counts": manifest["counts"], "problems": manifest["problems"],
            "pruned": [p.name for p in pruned]}


def due(folder: Path, user_id: str, now: datetime) -> bool:
    """One backup per UTC day."""
    d = folder / str(user_id)[:8]
    return not any(p.name.startswith(f"second-brain-backup-{now:%Y-%m-%d}T") for p in d.glob("*.sbz")) if d.exists() else True


def tick(db=None, now: datetime | None = None) -> list[dict]:
    """The scheduler's daily pass (only when BACKUP_ENABLED)."""
    from core.config import settings
    if not settings.backup_enabled:
        return []
    if db is None:
        from services.database import get_supabase
        db = get_supabase()
    from services.workspace import storage
    now = now or datetime.now(timezone.utc)
    folder = backup_dir(settings.backup_dir)
    out = []
    for r in db.table("profiles").select("id").execute().data or []:
        uid = str(r["id"])
        try:
            if due(folder, uid, now):
                out.append(run_for_user(db, uid, folder, storage_download=storage.download, skills_dirs=default_skill_dirs(), now=now))
        except Exception:
            log.exception("backup failed for %s", uid[:8])
    return out
