"""The switchboard: decide where each AI request runs, and what may go there.

Spec: docs/superpowers/specs/2026-10-04-local-brain-switchboard-design.md

  policy.py      the user's editable policy (slots, rules, instructions,
                 privacy, brain), versioned in `routing_policies`
  rules.py       signals for one request + deterministic rule evaluation
  brain.py       the pluggable decider for what the rules leave open
  switchboard.py route(): signals → rules → brain → a provider for a slot
  log.py         one `routing_decisions` row per routed request
"""
