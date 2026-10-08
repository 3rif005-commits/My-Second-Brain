"""Notion errors, classified the way the engine needs them (ROBUSTNESS §9)."""
from __future__ import annotations


class NotionError(Exception):
    def __init__(self, status: int, code: str, message: str = "", retry_after: float | None = None):
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.message = message
        self.retry_after = retry_after

    @property
    def error_class(self) -> str:
        return classify(self)


class AmbiguousWrite(Exception):
    """A write whose outcome is unknown (timeout / 5xx / dropped connection).
    The write may or may not have landed; a create must be reconciled, never
    blindly repeated (ADR-05)."""

    def __init__(self, what: str, cause: str = ""):
        super().__init__(f"{what} outcome unknown: {cause}")
        self.what = what
        self.cause = cause


class NotConnected(Exception):
    """No usable connection (token missing, revoked or paused)."""


def classify(err: NotionError) -> str:
    """retryable | permanent | needs_user."""
    if err.status in (401, 403) or err.code in ("unauthorized", "restricted_resource",
                                                 "object_not_found", "public_api_request_blocked"):
        return "needs_user"
    if err.status == 429 or err.status >= 500 or err.code in ("rate_limited", "conflict_error"):
        return "retryable"
    return "permanent"


PLAIN = {
    "unauthorized": "Notion disconnected this app. Reconnect to resume. Your notes are safe.",
    "restricted_resource": "Notion no longer lets this connection see that page. Share it again in Notion.",
    "object_not_found": "This page is no longer reachable in Notion (deleted or unshared).",
    "rate_limited": "Notion asked us to slow down; it will be retried.",
    "validation_error": "Notion refused part of this note. It was reported as a bug; nothing was lost here.",
    "public_api_request_blocked": "Your Notion workspace blocks this connection.",
}


def plain_message(err: Exception) -> str:
    """A sentence for the user. Never includes note content."""
    if isinstance(err, NotionError):
        if err.status >= 500:
            return "Notion isn't responding. We'll retry; nothing is lost."
        return PLAIN.get(err.code, "Notion refused the request.")
    if isinstance(err, AmbiguousWrite):
        return "Notion didn't answer in time. We'll check what arrived before trying again."
    return "Something went wrong."
