"""SmartRouter — finds the LOCAL model: LiteRT tablet → llama.cpp laptop. Nothing else.

Priority:
  1. LiteRT tablet  (if LITERT_URL set and tablet responds within 2 s)
  2. llama.cpp local (if LLM_PROVIDER=llamacpp)

There is deliberately no cloud fallback. This is what the "local" provider resolves to, and the
privacy gate lets private notes reach "local": falling back to OpenRouter here (as it once did)
would send them to a cloud on any server without a local model, e.g. the deployed backend.

Health status is cached for 30 s so we don't ping the tablet on every token request.
"""

import time
import logging
import httpx
from core.config import settings

logger = logging.getLogger(__name__)

HEALTH_TTL = 30          # seconds between tablet health re-checks
HEALTH_TIMEOUT = 2.0     # seconds to wait for tablet health response



class LocalModelUnavailable(RuntimeError):
    """No local model on this server: no tablet answering and LLM_PROVIDER isn't llamacpp."""


class SmartRouter:
    def __init__(self) -> None:
        self._tablet_alive: bool = False
        self._last_check: float = 0.0

    def _probe_tablet(self) -> bool:
        """Synchronous health probe — called at most once per HEALTH_TTL seconds."""
        url = settings.litert_url
        if not url:
            return False
        try:
            resp = httpx.get(f"{url}/health", timeout=HEALTH_TIMEOUT)
            alive = resp.status_code == 200
        except Exception:
            alive = False
        logger.info(f"smartrouter | tablet_probe | alive={alive} | url={url}")
        return alive

    def _tablet_ok(self) -> bool:
        now = time.monotonic()
        if now - self._last_check >= HEALTH_TTL:
            self._tablet_alive = self._probe_tablet()
            self._last_check = now
        return self._tablet_alive

    def get_endpoint(self) -> dict:
        """Return the local generation endpoint, or raise LocalModelUnavailable.

        Returns a dict with:
          url      — full completions URL
          headers  — HTTP headers
          model    — model name string for the payload
          source   — 'tablet' | 'llamacpp'
        """
        # 1. LiteRT tablet
        if self._tablet_ok():
            logger.info("smartrouter | routing → tablet")
            return {
                "url": f"{settings.litert_url}/v1/chat/completions",
                "headers": {"Content-Type": "application/json"},
                "model": settings.llamacpp_model,
                "source": "tablet",
            }

        # 2. Local llama.cpp (llama.cpp prize path)
        if settings.llm_provider == "llamacpp":
            logger.info("smartrouter | routing → llamacpp")
            return {
                "url": f"{settings.llamacpp_base_url}/v1/chat/completions",
                "headers": {"Content-Type": "application/json"},
                "model": settings.llamacpp_model,
                "source": "llamacpp",
            }

        raise LocalModelUnavailable(
            "No local model is running on this server (no tablet, and LLM_PROVIDER isn't "
            "llamacpp). Point this role at a cloud provider in Settings → Routing, or run the "
            "app on your own machine with the local model. Private notes are never sent to a "
            "cloud instead.")


smart_router = SmartRouter()
