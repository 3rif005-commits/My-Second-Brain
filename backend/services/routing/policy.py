"""The routing policy — everything the user can edit in Settings → Routing.

A policy is one JSON document:

  slots         role → {provider, model}. Rules and instructions name roles,
                never models, so swapping hardware or a model is one change
                here. provider "auto" means "the first configured provider
                that can do it" — the behaviour the app had before routing.
  rules         ordered; the first enabled rule whose condition matches wins.
  default_slot  where a request goes when no rule matches and no brain runs.
  instructions  plain text the brain reads. Guidance, not a guarantee.
  privacy       untrusted provider keys + what to do when a private note is
                needed by a request routed to the cloud.
  brain         which decider runs: rules_only | local | cloud.

Stored as versions in `routing_policies`; the newest row is the active one.
Without the table (migration 029 not applied) every user gets the default.
"""
from __future__ import annotations

import copy
import logging
from typing import Any

logger = logging.getLogger(__name__)

SLOTS = ("local", "fast", "strong", "vision", "long")

SLOT_HELP = {
    "local": "on this device; nothing leaves the machine",
    "fast": "cheap cloud model for everyday questions",
    "strong": "best reasoning: proofs, plans, long synthesis",
    "vision": "images and documents with figures",
    "long": "very large context",
}

#: Capability a provider needs to fill a slot when its provider is "auto".
SLOT_CAPABILITY = {"vision": "vision", "long": "long_context"}

RULE_KINDS = {
    "message_matches": "message contains any of these words",
    "context_over": "estimated context is over N tokens",
    "surface_is": "request comes from this surface",
    "spend_today_over": "today's AI spend is at least $N",
    "always": "always",
}

#: A rule's `use` is a slot, or "brain" to let the brain decide.
BRAIN = "brain"

WHEN_PRIVATE = ("ask", "local", "drop")
BRAIN_KINDS = ("rules_only", "local", "cloud")

DEFAULT_INSTRUCTIONS = """\
You decide where a request runs. Pick exactly one slot.

- local: greetings, short factual lookups over my notes, rewording, tagging,
  anything that mentions health, money, family or passwords.
- fast: normal questions that need a capable model but not deep reasoning.
- strong: proofs, multi-step derivations, planning across many notes,
  writing study guides, anything I say is important.
- When unsure between two slots, pick the cheaper one.
"""

DEFAULT_POLICY: dict[str, Any] = {
    "slots": {s: {"provider": "local" if s == "local" else "auto", "model": ""}
              for s in SLOTS},
    "rules": [
        {"id": "sensitive-words", "enabled": True, "kind": "message_matches",
         "value": "password, bank account, diagnosis", "use": "local"},
        {"id": "big-context", "enabled": True, "kind": "context_over",
         "value": 30000, "use": "long"},
        {"id": "daily-cap", "enabled": False, "kind": "spend_today_over",
         "value": 1.0, "use": "local"},
    ],
    "default_slot": "fast",
    "instructions": DEFAULT_INSTRUCTIONS,
    "privacy": {"untrusted": [], "when_private_needed": "ask"},
    "brain": {"kind": "rules_only", "timeout_ms": 2500, "provider": ""},
}


class PolicyError(ValueError):
    """User-facing: names the field that is wrong."""


def default_policy() -> dict[str, Any]:
    return copy.deepcopy(DEFAULT_POLICY)


def validate(raw: dict[str, Any]) -> dict[str, Any]:
    """A complete, normalized policy, or PolicyError. Missing sections take
    their defaults, so an older stored policy keeps working when a field is
    added."""
    if not isinstance(raw, dict):
        raise PolicyError("policy must be an object")
    p = default_policy()

    slots = raw.get("slots") or {}
    if not isinstance(slots, dict):
        raise PolicyError("slots must be an object")
    for name, cfg in slots.items():
        if name not in SLOTS:
            raise PolicyError(f"unknown slot: {name}")
        if not isinstance(cfg, dict):
            raise PolicyError(f"slot {name} must be an object")
        p["slots"][name] = {"provider": str(cfg.get("provider") or "auto"),
                            "model": str(cfg.get("model") or "")}
    if p["slots"]["local"]["provider"] != "local":
        raise PolicyError("the local slot can only use the local model")

    if "rules" in raw:
        rules = raw["rules"]
        if not isinstance(rules, list):
            raise PolicyError("rules must be a list")
        seen: set[str] = set()
        out = []
        for i, r in enumerate(rules, 1):
            if not isinstance(r, dict):
                raise PolicyError(f"rule {i} must be an object")
            kind, use = r.get("kind"), r.get("use")
            if kind not in RULE_KINDS:
                raise PolicyError(f"rule {i}: unknown condition {kind!r}")
            if use not in SLOTS and use != BRAIN:
                raise PolicyError(f"rule {i}: unknown target {use!r}")
            rid = str(r.get("id") or f"rule-{i}")
            if rid in seen:
                raise PolicyError(f"rule {i}: duplicate id {rid!r}")
            seen.add(rid)
            value = r.get("value")
            if kind in ("context_over", "spend_today_over"):
                try:
                    value = float(value)
                except (TypeError, ValueError):
                    raise PolicyError(f"rule {i}: needs a number") from None
            elif kind in ("message_matches", "surface_is"):
                value = str(value or "")
                if not value.strip():
                    raise PolicyError(f"rule {i}: needs a value")
            out.append({"id": rid, "enabled": bool(r.get("enabled", True)),
                        "kind": kind, "value": value, "use": use})
        p["rules"] = out

    if "default_slot" in raw:
        if raw["default_slot"] not in SLOTS:
            raise PolicyError("default_slot must be a slot")
        p["default_slot"] = raw["default_slot"]

    if "instructions" in raw:
        text = str(raw["instructions"] or "")
        if len(text) > 4000:
            raise PolicyError("instructions are limited to 4000 characters")
        p["instructions"] = text

    priv = raw.get("privacy") or {}
    if priv:
        when = priv.get("when_private_needed", p["privacy"]["when_private_needed"])
        if when not in WHEN_PRIVATE:
            raise PolicyError("when_private_needed must be ask, local or drop")
        untrusted = priv.get("untrusted") or []
        if not isinstance(untrusted, list):
            raise PolicyError("privacy.untrusted must be a list")
        p["privacy"] = {"untrusted": [str(u) for u in untrusted],
                        "when_private_needed": when}

    brain = raw.get("brain") or {}
    if brain:
        kind = brain.get("kind", "rules_only")
        if kind not in BRAIN_KINDS:
            raise PolicyError("brain.kind must be rules_only, local or cloud")
        try:
            timeout = int(brain.get("timeout_ms", 2500))
        except (TypeError, ValueError):
            raise PolicyError("brain.timeout_ms must be a number") from None
        p["brain"] = {"kind": kind,
                      "timeout_ms": max(200, min(timeout, 20000)),
                      "provider": str(brain.get("provider") or "")}
    return p


# ---- storage ---------------------------------------------------------------

def _table():
    from services.database import get_supabase
    return get_supabase().table("routing_policies")


def load(user_id: str) -> dict[str, Any]:
    """The active policy. Never raises: a broken or missing row is the default."""
    if not user_id:
        return default_policy()
    try:
        rows = (_table().select("policy, version").eq("user_id", user_id)
                .order("version", desc=True).limit(1).execute().data or [])
    except Exception as e:                             # noqa: BLE001
        logger.info("routing_policies unavailable (%s); using default", e)
        return default_policy()
    if not rows:
        return default_policy()
    try:
        return validate(rows[0]["policy"])
    except PolicyError as e:
        logger.warning("stored routing policy invalid (%s); using default", e)
        return default_policy()


def versions(user_id: str) -> list[dict[str, Any]]:
    rows = (_table().select("version, note, created_at").eq("user_id", user_id)
            .order("version", desc=True).limit(50).execute().data or [])
    return rows


def save(user_id: str, raw: dict[str, Any], note: str = "") -> dict[str, Any]:
    """Validate and store as a new version. Returns {version, policy}."""
    policy = validate(raw)
    latest = (_table().select("version").eq("user_id", user_id)
              .order("version", desc=True).limit(1).execute().data or [])
    version = (latest[0]["version"] + 1) if latest else 1
    _table().insert({"user_id": user_id, "version": version,
                     "policy": policy, "note": note[:120]}).execute()
    return {"version": version, "policy": policy}


def restore(user_id: str, version: int | None) -> dict[str, Any]:
    """Make an old version (or the default, when None) active again — as a new
    version, so the history is never rewritten."""
    if version is None:
        return save(user_id, default_policy(), note="Restored default")
    rows = (_table().select("policy").eq("user_id", user_id)
            .eq("version", version).limit(1).execute().data or [])
    if not rows:
        raise PolicyError(f"no version {version}")
    return save(user_id, rows[0]["policy"], note=f"Restored v{version}")
