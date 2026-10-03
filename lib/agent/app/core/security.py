"""Authentication for the agent's own API surface.

The agent had no authentication of any kind while running on ``0.0.0.0:8000``,
so anyone who could reach the port could spend the LLM key, read any
conversation out of the checkpointer, and — via ``/ai/chat/resume`` — supply
the approval for a sensitive tool in someone else's thread.

The server is the only legitimate client and presents a shared secret. This
module enforces it in constant time and **fails closed**: an unset
``INTERNAL_API_KEY`` refuses every request rather than meaning "no key needed".
"""

import hmac

from fastapi import Header

from app.core.config import settings
from app.core.errors.errors import AgentError


class InternalKeyRequired(AgentError):
    """Raised when the shared internal key is missing or wrong (HTTP 401)."""

    status_code = 401

    def __init__(self, message: str = "internal service key required") -> None:
        """Fixed message; never reveals whether the key exists on this side."""
        super().__init__(message)


def check_internal_key(value: str | None) -> None:
    """Verify the shared secret in constant time, failing closed."""
    expected = settings.internal_api_key
    if not expected:
        # Fail closed: a missing key must never degrade to "open".
        raise InternalKeyRequired("INTERNAL_API_KEY is not configured on the agent")
    if not value or not hmac.compare_digest(
        str(value).encode(), str(expected).encode()
    ):
        raise InternalKeyRequired()


def require_internal_key(x_internal_key: str | None = Header(default=None)) -> None:
    """FastAPI dependency wrapper around :func:`check_internal_key`."""
    check_internal_key(x_internal_key)
