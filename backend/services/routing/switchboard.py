"""route(): one request in, one Route out.

  1 signals   built by the caller (it has the retrieval results)
  2 manual    the user picked a slot in the composer → that slot
  3 rules     first enabled match → its slot, or "brain"
  4 brain     the configured decider; no decision → the default slot
  5 resolve   slot → a concrete Provider that can serve an agent turn

Privacy is applied by the caller after this, inside `privacy.scope(ceiling)`:
the ceiling comes from the provider chosen here, so the route is decided
first and the context is cut to fit it.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

from services import privacy
from services.routing import brain as brain_mod
from services.routing import rules as rules_mod
from services.routing.policy import BRAIN, SLOT_CAPABILITY, SLOTS

#: Dialects services.ai.agent_stream can drive a tool loop in.
AGENT_DIALECTS = {"anthropic", "openai", "openai_compatible", "local"}


class NoProvider(RuntimeError):
    """User-facing: no configured provider can serve the chosen slot."""


@dataclass
class Route:
    slot: str
    provider: Any                      # services.ai.providers.Provider
    decided_by: str                    # rule | brain | user | fallback
    reason: str
    rule_id: str | None = None
    confidence: float | None = None
    latency_ms: int = 0
    ceiling: str = "personal"
    notes: list[str] = field(default_factory=list)   # e.g. "brain took over 2500 ms"

    @property
    def is_local(self) -> bool:
        return self.provider.provider == "local"


def resolve_slot(slot: str, policy: dict[str, Any], user_id: str,
                 agent: bool = True):
    """The provider (with its model set) behind a slot.

    `provider` "auto" walks the app's normal preference order and takes the
    first provider that has the slot's capability; any other value names a
    provider by its trust key ("anthropic", "openrouter.ai") or its label.
    """
    from services.ai.providers import list_providers, local_provider

    cfg = policy["slots"].get(slot) or {"provider": "auto", "model": ""}
    if slot == "local" or cfg["provider"] == "local":
        p = local_provider()
        return replace(p, chat_model=cfg["model"]) if cfg.get("model") else p

    need = SLOT_CAPABILITY.get(slot, "text")
    skipped: list[str] = []
    for p in list_providers(user_id):
        if p.provider == "local":
            continue
        if cfg["provider"] != "auto" and cfg["provider"] not in (
                privacy.provider_key(p), p.label):
            continue
        if need not in p.capabilities:
            skipped.append(f"{p.label or p.provider} (no {need})")
            continue
        if agent and p.provider not in AGENT_DIALECTS:
            skipped.append(f"{p.label or p.provider} (no tool-loop adapter yet)")
            continue
        if not p.api_key:
            skipped.append(f"{p.label or p.provider} (no API key)")
            continue
        return replace(p, chat_model=cfg["model"]) if cfg.get("model") else p
    detail = "; ".join(skipped) if skipped else "none configured"
    raise NoProvider(f"Nothing can serve the {slot} slot — {detail}. "
                     "Map it in Settings → Routing → Targets.")


async def route(policy: dict[str, Any], user_id: str, signals: rules_mod.Signals,
                manual_slot: str | None = None, agent: bool = True) -> Route:
    """Decide where a request runs. Raises NoProvider when the decided slot
    and every fallback have nothing behind them."""
    notes: list[str] = []
    slot: str
    decided_by: str
    reason: str
    rule_id: str | None = None
    confidence: float | None = None
    latency = 0

    if manual_slot in SLOTS:
        slot, decided_by, reason = manual_slot, "user", "you picked it"
    else:
        hit = rules_mod.first_match(policy["rules"], signals,
                                    spend=lambda: rules_mod.spend_today(user_id))
        if hit is not None and hit["use"] != BRAIN:
            slot, decided_by = hit["use"], "rule"
            reason, rule_id = rules_mod.describe(hit), hit["id"]
        else:
            if hit is not None:
                rule_id = hit["id"]
            kind = policy["brain"]["kind"]
            bp = brain_mod.brain_provider(policy, user_id)
            d = await brain_mod.decide(kind, bp, signals.query, signals,
                                       list(SLOTS), policy["instructions"],
                                       policy["brain"]["timeout_ms"])
            latency = d.latency_ms
            if d.slot:
                slot, decided_by, reason = d.slot, "brain", d.reason
                confidence = d.confidence
            else:
                slot = policy["default_slot"]
                decided_by = "fallback" if d.error else "rule"
                reason = "default" if not d.error else f"default ({d.error})"
                if d.error:
                    notes.append(d.error)

    try:
        provider = resolve_slot(slot, policy, user_id, agent=agent)
    except NoProvider as e:
        if decided_by == "user":
            raise
        # A rule or the brain picked a slot nothing fills (say, `long` with no
        # long-context key): fall back to the default slot, then to local.
        notes.append(str(e))
        provider = None
        for fallback in dict.fromkeys([policy["default_slot"], "local"]):
            if fallback == slot:
                continue
            try:
                provider = resolve_slot(fallback, policy, user_id, agent=agent)
            except NoProvider as e2:
                notes.append(str(e2))
                continue
            reason = f"{reason}; {slot} unavailable, used {fallback}"
            slot, decided_by = fallback, "fallback"
            break
        if provider is None:
            raise

    return Route(slot=slot, provider=provider, decided_by=decided_by,
                 reason=reason, rule_id=rule_id, confidence=confidence,
                 latency_ms=latency,
                 ceiling=privacy.ceiling_for(provider,
                                             policy["privacy"]["untrusted"]),
                 notes=notes)
