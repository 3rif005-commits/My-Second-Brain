"""A token Supabase confirmed is not re-checked on every request (it was
2,399 round trips in one session) — but never trusted past its expiry."""
import base64
import json
import time
from unittest.mock import MagicMock, patch

import pytest

from routers import ingest


def _token(exp: float) -> str:
    body = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).decode().rstrip("=")
    return f"h.{body}.s"


@pytest.fixture(autouse=True)
def _fresh():
    ingest._AUTH_CACHE.clear()
    yield
    ingest._AUTH_CACHE.clear()


def _sb(user_id="u1"):
    sb = MagicMock()
    sb.auth.get_user.return_value = MagicMock(user=MagicMock(id=user_id))
    return sb


def test_a_confirmed_token_is_not_checked_again_right_away():
    sb = _sb()
    tok = _token(time.time() + 3600)
    with patch.object(ingest, "get_supabase", return_value=sb):
        assert ingest.get_user_id(f"Bearer {tok}") == "u1"
        assert ingest.get_user_id(f"Bearer {tok}") == "u1"
    assert sb.auth.get_user.call_count == 1


def test_never_trusted_past_its_own_expiry():
    sb = _sb()
    tok = _token(time.time() + 1)              # expires in a second
    with patch.object(ingest, "get_supabase", return_value=sb):
        ingest.get_user_id(f"Bearer {tok}")
        key = next(iter(ingest._AUTH_CACHE))
        assert ingest._AUTH_CACHE[key][1] <= time.time() + 1.01


def test_the_cache_expires():
    sb = _sb()
    tok = _token(time.time() + 3600)
    with patch.object(ingest, "get_supabase", return_value=sb):
        ingest.get_user_id(f"Bearer {tok}")
        for k in ingest._AUTH_CACHE:
            ingest._AUTH_CACHE[k] = (ingest._AUTH_CACHE[k][0], time.time() - 1)
        ingest.get_user_id(f"Bearer {tok}")
    assert sb.auth.get_user.call_count == 2


def test_a_rejected_token_is_never_cached():
    sb = MagicMock()
    sb.auth.get_user.return_value = MagicMock(user=None)
    with patch.object(ingest, "get_supabase", return_value=sb), pytest.raises(Exception):
        ingest.get_user_id("Bearer bad")
    assert ingest._AUTH_CACHE == {}
