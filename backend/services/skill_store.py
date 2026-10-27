"""Skills per user: the database is the truth, a private folder is the cache.

Until migration 033 every account read and wrote one server folder
(~/.secondbrain/skills): one user's edited skill became every user's
instructions, and Render wiped it at each deploy. Now a user's skills are rows
in `user_skills` (RLS, like notes). The rest of the app reads skills as files
(the registry, the study guide's byte-exact prompt readers), so each user's
rows are written out to a folder of their own — `<tmp>/secondbrain-skills/<uid>`
— and the readers are pointed at it. The folder is only ever rebuilt from the
database; nothing writes into it directly.

Whose folder? The user of the current request or job, carried by a context
variable that `routers.ingest.get_user_id` sets on every authenticated request
and every background entry point sets for its job (`as_user`). With no user the
answer is an empty folder: built-in skills only. There is no path by which one
user's skills reach another user's prompt.
"""
from __future__ import annotations

import logging
import re
import shutil
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Iterator

logger = logging.getLogger(__name__)

ROOT = Path(tempfile.gettempdir()) / "secondbrain-skills"

NAME = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")
#: The files a skill folder may hold: its instructions and its reference texts.
FILE = re.compile(r"^(SKILL\.md|(reference|references)/[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(md|txt))$")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

FILE_MAX = 100_000          # characters per file
SKILL_MAX = 300_000         # characters per skill, all files
SKILLS_MAX = 100            # skills per user
ORIGINS = ("user", "assistant", "installed")

#: How long a user's folder is trusted before it is rebuilt from the database.
#: Writes through this module rebuild at once; the TTL only covers a change
#: made elsewhere (another instance, the SQL editor).
_SYNC_TTL = 60.0

_current: ContextVar[str | None] = ContextVar("skill_store_user", default=None)
_synced: dict[str, float] = {}
_lock = threading.Lock()


class SkillsUnavailable(RuntimeError):
    """The user_skills table does not exist (migration 033 not applied)."""


class SkillRejected(ValueError):
    """User-facing: why a skill or file was not saved."""


# ── whose skills ────────────────────────────────────────────────────────────

def _valid_user(user_id: str | None) -> str | None:
    uid = str(user_id or "").lower()
    return uid if _UUID.match(uid) else None


def set_user(user_id: str | None) -> None:
    """Called by get_user_id: the rest of this request reads this user's skills."""
    _current.set(_valid_user(user_id))


def current_user() -> str | None:
    return _current.get()


@contextmanager
def as_user(user_id: str | None) -> Iterator[None]:
    """For work outside a request (jobs, source processing, synthesis)."""
    token = _current.set(_valid_user(user_id))
    try:
        yield
    finally:
        _current.reset(token)


# ── reading: the per-user folder ────────────────────────────────────────────

def _empty_dir() -> Path:
    """Built-ins only. Kept empty: anything found in it is removed."""
    path = ROOT / "_none"
    if path.is_dir() and any(path.iterdir()):
        shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _rows(uid: str) -> list[dict]:
    from services.database import get_supabase
    try:
        return (get_supabase().table("user_skills").select("name, files, origin")
                .eq("user_id", uid).execute().data or [])
    except Exception as e:                                # noqa: BLE001
        text = str(e)
        if "user_skills" in text and ("does not exist" in text or "PGRST205" in text
                                      or "schema cache" in text):
            raise SkillsUnavailable("Your own skills need database migration 033.") from None
        raise


def _materialize(uid: str, rows: list[dict]) -> Path:
    ROOT.mkdir(parents=True, exist_ok=True)
    staging = ROOT / f".{uid}.{uuid.uuid4().hex}"
    staging.mkdir()
    for row in rows:
        name = str(row.get("name") or "")
        if not NAME.match(name):
            continue
        for rel, text in (row.get("files") or {}).items():
            if not FILE.match(rel) or not isinstance(text, str):
                continue
            dest = staging / name / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(text, encoding="utf-8")
    final = ROOT / uid
    old = ROOT / f".{uid}.old.{uuid.uuid4().hex}"
    if final.exists():
        final.rename(old)
    staging.rename(final)
    shutil.rmtree(old, ignore_errors=True)
    return final


def user_skills_dir(user_id: str | None = None) -> Path:
    """This user's skill folder (the current user's by default), up to date
    with the database; an empty folder when there is no user."""
    uid = _valid_user(user_id) if user_id is not None else _current.get()
    if not uid:
        return _empty_dir()
    final = ROOT / uid
    with _lock:
        if time.monotonic() - _synced.get(uid, float("-inf")) < _SYNC_TTL and final.is_dir():
            return final
        try:
            rows = _rows(uid)
        except SkillsUnavailable:
            rows = []
        except Exception as e:                            # noqa: BLE001
            # The database is unreachable: a stale copy of the user's own
            # skills beats none, and is still only theirs.
            logger.warning("skills for %s not refreshed: %s", uid, e)
            return final if final.is_dir() else _empty_dir()
        _materialize(uid, rows)
        _synced[uid] = time.monotonic()
    return final


def invalidate(user_id: str) -> None:
    with _lock:
        _synced.pop(str(user_id).lower(), None)


# ── writing ─────────────────────────────────────────────────────────────────

def _table():
    from services.database import get_supabase
    return get_supabase().table("user_skills")


def _require(uid: str | None) -> str:
    uid = _valid_user(uid)
    if not uid:
        raise SkillRejected("No user for this skill.")
    return uid


def get_row(user_id: str, name: str) -> dict | None:
    uid = _require(user_id)
    rows = [r for r in _rows(uid) if r.get("name") == name]
    return rows[0] if rows else None


def origins(user_id: str) -> dict[str, str]:
    """name → origin for the user's own rows ({} without migration 033)."""
    try:
        return {r["name"]: r.get("origin") or "user" for r in _rows(_require(user_id))}
    except SkillsUnavailable:
        return {}


def put_files(user_id: str, name: str, files: dict[str, str | None],
              origin: str | None = None) -> dict:
    """Write (or, with None, remove) files of one skill. A skill that ends up
    with no files is deleted. Raises SkillRejected / SkillsUnavailable."""
    uid = _require(user_id)
    if not NAME.match(name):
        raise SkillRejected("A skill name is lowercase letters, digits and dashes.")
    if origin is not None and origin not in ORIGINS:
        raise SkillRejected(f"unknown origin {origin!r}")
    for rel, text in files.items():
        if not FILE.match(rel):
            raise SkillRejected(f"'{rel}' is not a file a skill may hold.")
        if text is not None and len(text) > FILE_MAX:
            raise SkillRejected(f"'{rel}' is longer than {FILE_MAX:,} characters.")
    rows = _rows(uid)
    current = next((r for r in rows if r.get("name") == name), None)
    if current is None and len(rows) >= SKILLS_MAX:
        raise SkillRejected(f"You have {SKILLS_MAX} skills of your own. Delete one first.")
    merged = dict((current or {}).get("files") or {})
    for rel, text in files.items():
        if text is None:
            merged.pop(rel, None)
        else:
            merged[rel] = text
    if sum(len(t) for t in merged.values()) > SKILL_MAX:
        raise SkillRejected(f"A skill holds at most {SKILL_MAX:,} characters in all.")
    if not merged:
        delete(uid, name)
        return {"name": name, "files": {}}
    row = {"user_id": uid, "name": name, "files": merged,
           "origin": origin or (current or {}).get("origin") or "user",
           "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    _table().upsert(row, on_conflict="user_id,name").execute()
    invalidate(uid)
    return row


def delete(user_id: str, name: str) -> bool:
    uid = _require(user_id)
    rows = _table().delete().eq("user_id", uid).eq("name", name).execute().data or []
    invalidate(uid)
    return bool(rows)
