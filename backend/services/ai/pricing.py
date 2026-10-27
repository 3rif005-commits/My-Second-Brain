"""Model prices and the token/cost arithmetic the harness scoreboard uses.

This is the ONLY place a dollar figure is derived, so the estimate a user sees
before a run and the cost recorded after one can never disagree.

Prices are USD per 1M tokens, first-party API list rates. An unpriced model
returns None rather than 0.0 — "we don't know" and "it's free" are different
answers, and showing $0.00 for an unknown model is the worse lie.
"""
from __future__ import annotations

import math

# model id → (input $/MTok, output $/MTok)
PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-sonnet-5": (2.00, 10.00),
    "claude-opus-5": (5.00, 25.00),
    "gpt-4o-mini": (0.15, 0.60),
}

# A local model costs nothing per token; the electricity is not billed here.
FREE_PREFIXES = ("local/", "gemma", "nvidia/nemotron")

# Rough bytes-per-token. Real counting needs the provider's tokenizer (and for
# Anthropic, a count_tokens round trip) — this is only ever used for the
# pre-run ESTIMATE. Post-run numbers come from the provider's usage fields.
CHARS_PER_TOKEN = 4


def tokens_from_chars(chars: int) -> int:
    return math.ceil(max(chars, 0) / CHARS_PER_TOKEN)


def price_for(model: str | None) -> tuple[float, float] | None:
    """(input, output) $/MTok for a model id, or None when unpriced."""
    if not model:
        return None
    # A configured custom provider can carry its own price. Left unset it stays
    # unpriced, which reports "we don't know" rather than "it was free" — the
    # difference that keeps a bill from arriving as a surprise.
    from core.config import settings
    if model == settings.custom_llm_model and settings.custom_llm_price_in is not None:
        return (settings.custom_llm_price_in, settings.custom_llm_price_out or 0.0)
    from services import nebius                     # HACKATHON-NEBIUS
    tf = nebius.price_for(model)
    if tf is not False:
        return tf
    if model in PRICES:
        return PRICES[model]
    # OpenRouter marks no-cost models with a `:free` suffix.
    if model.endswith(":free") or model.lower().startswith(FREE_PREFIXES):
        return (0.0, 0.0)
    # Date-suffixed variants (claude-haiku-4-5-20251001) price as their base.
    for known, price in PRICES.items():
        if model.startswith(known):
            return price
    return None


def estimate_usd(model: str | None, input_tokens: int,
                 output_tokens: int, cached_input_tokens: int = 0,
                 cache_write_tokens: int = 0) -> float | None:
    """Cost of a run, or None when the model is unpriced.

    Cached input is billed at roughly a tenth of the input rate; it is passed
    separately rather than folded into `input_tokens` so the caller's numbers
    stay auditable against the provider's own usage fields.

    A cache WRITE costs 1.25x the input rate (5-minute cache), and Anthropic
    reports those tokens outside `input_tokens`. Leaving them out made a
    cached run look cheaper than an uncached one on its very first call —
    the call that pays the premium.
    """
    price = price_for(model)
    if price is None:
        return None
    in_rate, out_rate = price
    return round(
        (input_tokens * in_rate
         + cached_input_tokens * in_rate * 0.1
         + cache_write_tokens * in_rate * 1.25
         + output_tokens * out_rate) / 1_000_000,
        6,
    )
