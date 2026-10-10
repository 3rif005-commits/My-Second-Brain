"""services/secrets.py — encryption at rest for tokens (Notion sync M0)."""
import pytest
from cryptography.fernet import Fernet

from services import secrets

K1 = Fernet.generate_key().decode()
K2 = Fernet.generate_key().decode()


def test_round_trip_and_ciphertext_hides_the_token():
    sealed = secrets.encrypt("ntn_supersecret_token_1234", raw_keys=K1)
    assert b"supersecret" not in sealed.ciphertext
    assert sealed.key_id == secrets.key_id(K1)
    assert secrets.decrypt(sealed.ciphertext, raw_keys=K1) == "ntn_supersecret_token_1234"


def test_missing_key_fails_closed():
    with pytest.raises(secrets.SecretsUnavailable):
        secrets.encrypt("x" * 10, raw_keys="")
    with pytest.raises(secrets.SecretsUnavailable):
        secrets.decrypt(b"anything", raw_keys=" , ")


def test_bad_key_is_reported_as_unavailable():
    with pytest.raises(secrets.SecretsUnavailable):
        secrets.encrypt("x" * 10, raw_keys="not-a-fernet-key")


def test_wrong_key_cannot_read():
    sealed = secrets.encrypt("token-abcdefgh", raw_keys=K1)
    with pytest.raises(secrets.SecretUnreadable):
        secrets.decrypt(sealed.ciphertext, raw_keys=K2)


def test_rotation_new_key_first_old_key_still_reads_then_reseal():
    old = secrets.encrypt("token-abcdefgh", raw_keys=K1)
    both = f"{K2},{K1}"
    assert secrets.decrypt(old.ciphertext, raw_keys=both) == "token-abcdefgh"
    new = secrets.reseal(old.ciphertext, raw_keys=both)
    assert new.key_id == secrets.key_id(K2)
    assert secrets.decrypt(new.ciphertext, raw_keys=K2) == "token-abcdefgh"


def test_empty_secret_refused():
    with pytest.raises(ValueError):
        secrets.encrypt("", raw_keys=K1)


def test_hint_shows_only_last_four():
    assert secrets.hint("ntn_1234567890abcd") == "…abcd"
    assert secrets.hint("short") == "…"


def test_reads_key_from_settings(monkeypatch):
    from core.config import settings
    monkeypatch.setattr(settings, "secrets_key", K1)
    assert secrets.decrypt(secrets.encrypt("token-abcdefgh").ciphertext) == "token-abcdefgh"
