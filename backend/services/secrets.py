"""Secrets at rest: encrypt a token before it goes into the database.

First user: the Notion connection token (docs/notion-sync/DESIGN.md §6.5).
Until now every secret in this app was stored as plain TEXT
(`ai_providers.api_key`, ledger B5); nothing new may copy that.

The key lives in `backend/.env` as SECRETS_KEY, never in the database, so a
leaked database dump alone reveals nothing. SECRETS_KEY holds one or more
Fernet keys separated by commas: the FIRST encrypts, all of them decrypt.
Rotating = put a new key first, keep the old one after it, re-encrypt, then
drop the old one.

Fail closed: with no key configured, `encrypt` and `decrypt` raise
SecretsUnavailable. There is no plaintext fallback.

Generate a key:  python -m services.secrets generate
"""
from __future__ import annotations

import hashlib
import sys
from dataclasses import dataclass

from cryptography.fernet import Fernet, InvalidToken, MultiFernet


class SecretsUnavailable(RuntimeError):
    """No usable SECRETS_KEY: secrets can be neither stored nor read."""


class SecretUnreadable(ValueError):
    """The ciphertext was not made with any configured key (or was altered)."""


@dataclass(frozen=True)
class Sealed:
    ciphertext: bytes
    #: which key encrypted it — a short fingerprint, never the key itself
    key_id: str


def key_id(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()[:8]


def _keys(raw: str | None = None) -> list[str]:
    if raw is None:
        from core.config import settings
        raw = settings.secrets_key
    keys = [k.strip() for k in (raw or "").split(",") if k.strip()]
    if not keys:
        raise SecretsUnavailable(
            "SECRETS_KEY is not set in backend/.env. "
            "Generate one with: python -m services.secrets generate")
    return keys


def _fernet(keys: list[str]) -> MultiFernet:
    try:
        return MultiFernet([Fernet(k.encode()) for k in keys])
    except (ValueError, TypeError) as exc:
        raise SecretsUnavailable("SECRETS_KEY holds a value that is not a Fernet key.") from exc


def encrypt(plaintext: str, *, raw_keys: str | None = None) -> Sealed:
    if not plaintext:
        raise ValueError("Refusing to store an empty secret.")
    keys = _keys(raw_keys)
    return Sealed(_fernet(keys).encrypt(plaintext.encode()), key_id(keys[0]))


def decrypt(ciphertext: bytes, *, raw_keys: str | None = None) -> str:
    try:
        return _fernet(_keys(raw_keys)).decrypt(bytes(ciphertext)).decode()
    except InvalidToken as exc:
        raise SecretUnreadable("This secret was not encrypted with any configured key.") from exc


def reseal(ciphertext: bytes, *, raw_keys: str | None = None) -> Sealed:
    """Re-encrypt under the current first key (after a rotation)."""
    keys = _keys(raw_keys)
    try:
        return Sealed(_fernet(keys).rotate(bytes(ciphertext)), key_id(keys[0]))
    except InvalidToken as exc:
        raise SecretUnreadable("This secret was not encrypted with any configured key.") from exc


def hint(plaintext: str) -> str:
    """What the UI may show of a secret: its last four characters."""
    return "…" + plaintext[-4:] if len(plaintext) >= 8 else "…"


if __name__ == "__main__":
    if sys.argv[1:] == ["generate"]:
        print(Fernet.generate_key().decode())
    else:
        print("usage: python -m services.secrets generate")
        sys.exit(2)
