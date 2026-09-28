"""Role tools: let the model verify who it talks to (basic, via server HTTP)."""

import httpx
from langchain_core.tools import tool

from app.core.config import settings
from app.core.errors import ToolError


@tool
def get_user_role(user_id: str) -> str:
    """Look up a user's role (BUYER / SELLER / ADMIN) by their id."""
    try:
        resp = httpx.get(
            f"{settings.kosply_server_url}/internal/users/{user_id}",
            timeout=10.0,
        )
        resp.raise_for_status()
    except Exception as exc:
        raise ToolError(f"user lookup failed: {exc}") from exc
    data = resp.json() if isinstance(resp.json(), dict) else {}
    return str(data.get("role", "UNKNOWN")).upper()
