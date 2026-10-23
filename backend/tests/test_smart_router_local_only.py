"""The "local" provider must never resolve to a cloud: the privacy gate lets private notes reach
it. It used to fall back to OpenRouter on any server without a local model."""
from unittest.mock import patch

import pytest

from services.router import LocalModelUnavailable, SmartRouter


def test_no_local_model_raises_instead_of_falling_back_to_a_cloud():
    r = SmartRouter()
    with patch.object(r, "_tablet_ok", return_value=False), \
         patch("services.router.settings.llm_provider", "openrouter"), \
         patch("services.router.settings.openrouter_api_key", "sk-or-real-looking"):
        with pytest.raises(LocalModelUnavailable, match="No local model"):
            r.get_endpoint()


def test_llamacpp_and_tablet_are_local():
    r = SmartRouter()
    with patch.object(r, "_tablet_ok", return_value=False), \
         patch("services.router.settings.llm_provider", "llamacpp"):
        ep = r.get_endpoint()
    assert ep["source"] == "llamacpp" and "Authorization" not in ep["headers"]
    with patch.object(r, "_tablet_ok", return_value=True):
        assert r.get_endpoint()["source"] == "tablet"
