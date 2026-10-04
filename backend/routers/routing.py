"""Settings → Routing: the policy, its versions, the test bench, the log.

Spec: docs/superpowers/specs/2026-10-04-local-brain-switchboard-design.md §5.5
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from routers.ingest import get_user_id
from services import privacy
from services.routing import brain as brain_mod
from services.routing import log as routing_log
from services.routing import policy as routing_policy
from services.routing import switchboard

router = APIRouter(prefix="/routing", tags=["routing"])

_NEEDS_029 = ("Routing settings need migration 029 — run "
              "supabase/migrations/029_privacy_routing.sql in the Supabase SQL editor.")


def _storage_error(e: Exception) -> HTTPException:
    text = str(e)
    if "routing_" in text and ("does not exist" in text or "relation" in text
                               or "schema cache" in text):
        return HTTPException(503, _NEEDS_029)
    return HTTPException(500, f"Could not save: {text[:200]}")


@router.get("/policy")
def get_policy(authorization: str = Header(...)) -> dict[str, Any]:
    user_id = get_user_id(authorization)
    return {
        "policy": routing_policy.load(user_id),
        "default": routing_policy.default_policy(),
        "slots": list(routing_policy.SLOTS),
        "slot_help": routing_policy.SLOT_HELP,
        "rule_kinds": routing_policy.RULE_KINDS,
    }


class PolicyIn(BaseModel):
    policy: dict[str, Any]
    note: str = ""


@router.put("/policy")
def put_policy(body: PolicyIn, authorization: str = Header(...)) -> dict[str, Any]:
    user_id = get_user_id(authorization)
    try:
        return routing_policy.save(user_id, body.policy, note=body.note)
    except routing_policy.PolicyError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:                              # noqa: BLE001
        raise _storage_error(e) from e


@router.get("/policy/versions")
def get_versions(authorization: str = Header(...)) -> list[dict[str, Any]]:
    user_id = get_user_id(authorization)
    try:
        return routing_policy.versions(user_id)
    except Exception:                                   # noqa: BLE001
        return []


class RestoreIn(BaseModel):
    version: int | None = None          # None: the shipped default


@router.post("/policy/restore")
def restore(body: RestoreIn, authorization: str = Header(...)) -> dict[str, Any]:
    user_id = get_user_id(authorization)
    try:
        return routing_policy.restore(user_id, body.version)
    except routing_policy.PolicyError as e:
        raise HTTPException(404, str(e)) from e
    except Exception as e:                              # noqa: BLE001
        raise _storage_error(e) from e


@router.get("/targets")
def targets(authorization: str = Header(...)) -> dict[str, Any]:
    """What a slot can be mapped to, and what each slot resolves to now."""
    from services.ai.providers import list_providers

    user_id = get_user_id(authorization)
    policy = routing_policy.load(user_id)
    untrusted = set(policy["privacy"]["untrusted"])
    providers = []
    seen: set[str] = set()
    for p in list_providers(user_id):
        key = privacy.provider_key(p)
        if key in seen:
            continue
        seen.add(key)
        providers.append({
            "key": key, "label": p.label or p.provider, "provider": p.provider,
            "model": p.model, "capabilities": sorted(p.capabilities),
            "has_key": bool(p.api_key) or p.provider == "local",
            "trusted": p.provider == "local" or key not in untrusted,
            "ceiling": privacy.ceiling_for(p, untrusted),
        })
    slots = []
    for slot in routing_policy.SLOTS:
        try:
            p = switchboard.resolve_slot(slot, policy, user_id)
            slots.append({"slot": slot, "label": p.label or p.provider,
                          "model": p.model, "error": None})
        except switchboard.NoProvider as e:
            slots.append({"slot": slot, "label": None, "model": None, "error": str(e)})
    return {"providers": providers, "slots": slots}


class TestIn(BaseModel):
    query: str
    #: an unsaved draft from the editor; omitted = the saved policy
    policy: dict[str, Any] | None = None
    signals: dict[str, Any] | None = None
    slot: str | None = None


@router.post("/test")
async def test_route(body: TestIn, authorization: str = Header(...)) -> dict[str, Any]:
    """Run steps 1–5 of the pipeline for a sample message — no answer, no log
    row. With a model brain configured this does call the brain."""
    user_id = get_user_id(authorization)
    try:
        policy = (routing_policy.validate(body.policy) if body.policy is not None
                  else routing_policy.load(user_id))
    except routing_policy.PolicyError as e:
        raise HTTPException(400, str(e)) from e
    signals = brain_mod.test_inputs(body.query, body.signals)
    started = time.monotonic()
    try:
        r = await switchboard.route(policy, user_id, signals, manual_slot=body.slot)
    except switchboard.NoProvider as e:
        raise HTTPException(409, str(e)) from e
    return {
        "slot": r.slot, "provider": r.provider.label or r.provider.provider,
        "model": r.provider.model, "decided_by": r.decided_by, "reason": r.reason,
        "rule_id": r.rule_id, "confidence": r.confidence,
        "brain_ms": r.latency_ms, "total_ms": int((time.monotonic() - started) * 1000),
        "ceiling": r.ceiling, "on_device": r.is_local, "notes": r.notes,
        "signals": signals.public(),
    }


@router.post("/ping/{slot}")
async def ping(slot: str, authorization: str = Header(...)) -> dict[str, Any]:
    """A tiny real call through one slot: is it reachable, and how fast."""
    from services.ai.client import complete

    user_id = get_user_id(authorization)
    if slot not in routing_policy.SLOTS:
        raise HTTPException(404, "unknown slot")
    policy = routing_policy.load(user_id)
    try:
        p = switchboard.resolve_slot(slot, policy, user_id, agent=False)
    except switchboard.NoProvider as e:
        return {"ok": False, "error": str(e)}
    started = time.monotonic()
    try:
        reply = await asyncio.wait_for(asyncio.to_thread(
            complete, p, [{"role": "user", "content": "Reply with the word OK."}], 8),
            timeout=60)
    except Exception as e:                              # noqa: BLE001
        return {"ok": False, "error": str(e)[:300] or type(e).__name__,
                "label": p.label, "model": p.model}
    return {"ok": True, "ms": int((time.monotonic() - started) * 1000),
            "reply": (reply or "")[:40], "label": p.label, "model": p.model}


@router.get("/decisions")
def decisions(limit: int = 100, slot: str | None = None,
              decided_by: str | None = None,
              authorization: str = Header(...)) -> dict[str, Any]:
    user_id = get_user_id(authorization)
    try:
        rows = routing_log.recent(user_id, limit=limit, slot=slot,
                                  decided_by=decided_by)
    except Exception as e:                              # noqa: BLE001
        raise _storage_error(e) from e
    return {"rows": rows, "summary": routing_log.summary(rows)}
