"""HTTP client helpers for agent -> server calls.

The agent's tools reach the Express app over `/api/internal/*`. Every one of
those routes is behind `requireInternalKey` (lib/server/middlewares/internalKey.js),
so a call without `x-internal-key` is a 401.

This module exists because that header was missing from all six tool calls:
`search_catalog`, `get_product_detail`, `get_user_role`, `read_conversation`,
`send_chat_message` and `request_seller_contact` each returned 401 -> ToolError,
which left the agent able to talk but unable to do anything at all. The key was
loaded from the environment for inbound auth and then simply never used
outbound.
"""

from typing import Any

import httpx

from app.core.config import settings

TIMEOUT_S = 10.0


def server_headers() -> dict[str, str]:
    """Headers for any `/api/internal/*` call.

    Raises:
        RuntimeError: If `INTERNAL_API_KEY` is unset. Failing here at the first
            tool call is deliberate: silently issuing unauthenticated requests
            would turn a misconfiguration into six identical, unexplained 401s.
    """
    key = (settings.internal_api_key or "").strip()
    if not key:
        raise RuntimeError(
            "INTERNAL_API_KEY is not set; the agent cannot call the server's "
            "internal API (every /api/internal/* route requires it)"
        )
    return {"x-internal-key": key}


def server_get(path: str, **kwargs: Any) -> httpx.Response:
    """GET a server URL with the internal key attached."""
    return httpx.get(
        f"{settings.kosply_server_url}{path}",
        headers=server_headers(),
        timeout=TIMEOUT_S,
        **kwargs,
    )


def server_post(path: str, **kwargs: Any) -> httpx.Response:
    """POST to a server URL with the internal key attached."""
    return httpx.post(
        f"{settings.kosply_server_url}{path}",
        headers=server_headers(),
        timeout=TIMEOUT_S,
        **kwargs,
    )