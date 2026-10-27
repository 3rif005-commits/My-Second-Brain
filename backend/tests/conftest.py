"""Shared test fixtures."""
import uuid

import pytest
import pytest_asyncio


@pytest.fixture(autouse=True)
def no_real_supabase(monkeypatch, request):
    """No test may reach the real Supabase project.

    This is not hypothetical: the run log writes a row from inside
    `usage.track`, so any test that exercised a model call path wrote telemetry
    straight into the production `ai_runs` table — 21 junk rows with a null
    surface before anyone noticed. Telemetry is deliberately failure-tolerant,
    which is exactly why it never complained.

    Tests that want to observe what would have been written patch
    `services.database.get_supabase` themselves; that patch wins, because it is
    applied inside the test. Tests using the local pgtest harness are
    unaffected — that path never goes through this client.
    """
    def _refuse(*a, **kw):
        raise RuntimeError(
            "This test tried to reach the real Supabase project. Patch "
            "services.database.get_supabase (or the module-level alias the "
            "code under test imported) and assert on the calls instead."
        )

    monkeypatch.setattr("services.database.get_supabase", _refuse)


@pytest.fixture(autouse=True)
def neutral_provider_config(monkeypatch):
    """Tests must not depend on whatever is in the developer's .env.

    Provider order and availability are configuration, and this machine's .env
    legitimately changes them — `AI_DISABLED_PROVIDERS=anthropic` while its
    balance is empty, a CUSTOM_LLM_* block pointing at a gateway. Three router
    tests started failing for exactly that reason, which is a test isolation
    bug, not a routing bug. Each test sets the configuration it is about.
    """
    from core.config import settings

    monkeypatch.setattr(settings, "ai_disabled_providers", "")
    for field in ("custom_llm_base_url", "custom_llm_api_key",
                  "custom_llm_model", "custom_llm_label"):
        monkeypatch.setattr(settings, field, "")
    monkeypatch.setattr(settings, "custom_llm_price_in", None)
    monkeypatch.setattr(settings, "custom_llm_price_out", None)


@pytest.fixture(autouse=True)
def no_real_batch_api(monkeypatch):
    """No test may send a real request to a provider's batch API.

    A batch is paid work that outlives the test, and this machine's .env holds a
    real Anthropic key. With no adapters registered, `batch.adapter_for` finds
    none and every job plans at the normal price. A test of batch behaviour
    installs its own fake adapter.
    """
    monkeypatch.setattr("services.jobs.batch._ADAPTERS", {})


@pytest.fixture(autouse=True)
def route_via_get_provider(monkeypatch, request):
    """Chat turns pick their model through the switchboard (services/routing).
    The engine tests predate it and choose the model by patching
    `services.agent.engine.get_provider`; this keeps them testing the tool
    loop they were written for: the route is whatever that patch returns, at
    the `private` ceiling so the privacy gate filters nothing and looks
    nothing up. Routing and privacy tests opt out with `@pytest.mark.real_routing`.
    """
    if "real_routing" in request.keywords:
        return

    async def _route(policy, user_id, signals, manual_slot=None, agent=True):
        from models.agent import Mode
        from services.agent import engine
        from services.routing.switchboard import NoProvider, Route
        mode = Mode.LOCAL if manual_slot == "local" else Mode.API
        try:
            p = engine.get_provider(mode, task="chat", user_id=user_id)
        except RuntimeError as e:          # the switchboard's own failure type
            raise NoProvider(str(e)) from e
        return Route(slot=manual_slot or "fast", provider=p, decided_by="rule",
                     reason="test", ceiling="private")

    monkeypatch.setattr("services.routing.switchboard.route", _route)
    monkeypatch.setattr("services.privacy.fetch_levels", lambda ids, uid: {})
    monkeypatch.setattr("services.routing.log.record", lambda *a, **k: None)


@pytest.fixture
def hermetic_planning(monkeypatch):
    """The jobs worker plans a job from live services: the provider chain, the
    note's sources, the priced skill list. Modules that import `get_supabase`
    by name bypass the autouse guard above, so without this a jobs test reads
    the real project (it did — a query for the uuid "n1"). Nothing is found;
    a test that cares patches what it needs on top."""
    monkeypatch.setattr("services.jobs.worker.pick", lambda *a, **k: None)
    monkeypatch.setattr("services.jobs.worker.list_providers", lambda *a, **k: [])
    monkeypatch.setattr("services.workspace.skill_run.ready_sources", lambda *a, **k: [])
    monkeypatch.setattr("services.workspace.skill_run.chat_skills", lambda *a, **k: [])


@pytest.fixture
def tmp_skills_dir(tmp_path):
    """A temp directory with no skills, ready to be populated."""
    d = tmp_path / "skills"
    d.mkdir()
    return d


# ---------------------------------------------------------------------------
# Local pgtest harness fixtures (Milestone 2, database CRUD tests).
#
# SAFETY: this DSN is hardcoded and completely independent of
# `core.config.settings.database_url` (which now points at the real
# Supabase project). Nothing here ever imports or reads `settings`. Bring
# the harness up first: `./scripts/pgtest/up.sh && ./scripts/pgtest/apply.sh
# 001 014` (from the repo root) — these fixtures assume it's already running
# on localhost:55432 with all 14 migrations applied.
# ---------------------------------------------------------------------------

LOCAL_PGTEST_DSN = "postgresql://postgres:pw@localhost:55432/postgres"


@pytest_asyncio.fixture
async def db_conn():
    """A connection to the local pgtest harness, wrapped in a transaction
    that is ALWAYS rolled back on teardown (pass or fail) — no test needs
    manual cleanup, and no test can leak state into another.

    Uses the same jsonb codec (`services.db.connection._init_connection`)
    the production pool registers, so `db_conn.fetch(...)` results already
    decode jsonb columns to Python dict/list.
    """
    import asyncpg

    from services.db.connection import _init_connection

    conn = await asyncpg.connect(LOCAL_PGTEST_DSN)
    await _init_connection(conn)
    tr = conn.transaction()
    await tr.start()
    try:
        yield conn
    finally:
        await tr.rollback()
        await conn.close()


@pytest_asyncio.fixture
async def test_user(db_conn):
    """Inserts a fresh `auth.users` row (the pgtest shim) inside `db_conn`'s
    transaction, and returns the new user's id as a string. A fresh UUID
    per call, so tests never collide regardless of run order.

    Does NOT separately insert into `profiles`: migration 001's
    `on_auth_user_created` trigger (`handle_new_user()`) already inserts a
    matching `profiles` row for every `auth.users` insert — a second,
    explicit insert collides with it (`profiles_pkey` unique violation).
    """
    user_id = str(uuid.uuid4())
    email = f"{user_id}@test.local"
    await db_conn.execute(
        "INSERT INTO auth.users (id, email) VALUES ($1, $2)", user_id, email
    )
    return user_id


# ── per-user skills (services/skill_store.py) ──────────────────────────────

SKILL_USER = "00000000-0000-4000-8000-000000000001"
OTHER_SKILL_USER = "00000000-0000-4000-8000-000000000002"


class _FakeSkillTable:
    """The user_skills table, in memory: upsert and delete as the store uses them."""

    def __init__(self, rows: dict):
        self.rows = rows
        self._filters: dict = {}
        self._op = None

    def upsert(self, row, on_conflict=None):
        self.rows[(row["user_id"], row["name"])] = dict(row)
        self._op = "upsert"
        return self

    def delete(self):
        self._op = "delete"
        return self

    def update(self, values):
        self._op, self._values = "update", dict(values)
        return self

    def eq(self, key, value):
        self._filters[key] = value
        return self

    def in_(self, key, values):
        self._filters[key] = list(values)
        return self

    def _matches(self, uid, name):
        want = self._filters.get("name")
        return (uid == self._filters.get("user_id")
                and (name in want if isinstance(want, list) else name == want))

    def execute(self):
        from types import SimpleNamespace
        if self._op == "delete":
            key = (self._filters.get("user_id"), self._filters.get("name"))
            gone = self.rows.pop(key, None)
            return SimpleNamespace(data=[gone] if gone else [])
        if self._op == "update":
            hit = [r for (u, n), r in self.rows.items() if self._matches(u, n)]
            for r in hit:
                r.update(self._values)
            return SimpleNamespace(data=hit)
        return SimpleNamespace(data=[])


class _SyncedDir:
    """A user's skill folder that is rebuilt from the fake table before every
    path is taken from it — as the app reads it."""

    def __init__(self, user_id):
        self.user_id = user_id

    def __truediv__(self, part):
        from services import skill_store
        return skill_store.user_skills_dir(self.user_id) / part


@pytest.fixture
def skill_db(monkeypatch, tmp_path):
    """user_skills in memory, and a private cache folder for this test. Returns
    the rows dict, keyed (user_id, name)."""
    from services import skill_store
    rows: dict = {}
    monkeypatch.setattr(skill_store, "ROOT", tmp_path / "skills-cache")
    monkeypatch.setattr(skill_store, "_synced", {})
    monkeypatch.setattr(skill_store, "_rows", lambda uid: [
        {"name": n, "files": dict(r["files"]), "origin": r.get("origin", "user"),
         **{k: r.get(k) for k in ("created_at", "last_used_at", "archived_at")}}
        for (u, n), r in rows.items() if u == uid])
    monkeypatch.setattr(skill_store, "_touched", {})
    monkeypatch.setattr(skill_store, "_table", lambda: _FakeSkillTable(rows))
    return rows


@pytest.fixture
def skill_user_dir(skill_db):
    return _SyncedDir(SKILL_USER)


def signed_in_as(user_id):
    """A stand-in for get_user_id that names the user the way the real one
    does (services/skill_store.set_user)."""
    def fake(authorization=None):
        from services.skill_store import set_user
        set_user(user_id)
        return user_id
    return fake
