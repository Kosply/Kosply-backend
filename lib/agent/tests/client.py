"""Shared HTTP client factory for the agent test-suite.

Every `/ai/*` route now requires the server's shared `x-internal-key`. Tests
previously called the routes with no credential at all, which is exactly how the
unauthenticated surface went unnoticed.
"""

from httpx import ASGITransport, AsyncClient

from app.core.config import settings

KEY_HEADER = "x-internal-key"


def agent_headers() -> dict:
    """Headers a legitimate caller (the server) sends."""
    return {KEY_HEADER: settings.internal_api_key}


def agent_client(app, **kwargs) -> AsyncClient:
    """Build an ASGI-transport client that presents the internal key."""
    kwargs.setdefault("base_url", "http://test")
    kwargs.setdefault("headers", agent_headers())
    return AsyncClient(transport=ASGITransport(app=app), **kwargs)
