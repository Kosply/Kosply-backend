"""Role tools: let the model verify who it talks to (basic, via server HTTP)."""

from langchain_core.tools import tool

from app.core.config import settings
from app.core.http import server_get
from app.core.errors import ToolError


@tool
def get_user_role(user_id: str) -> str:
    """Look up a user's role (BUYER / SELLER / ADMIN) by their id."""
    try:
        resp = server_get(f"/api/internal/users/{user_id}")
        resp.raise_for_status()
    except Exception as exc:
        raise ToolError(f"user lookup failed: {exc}") from exc
    data = resp.json() if isinstance(resp.json(), dict) else {}
    item = data.get("item", {}) if isinstance(data.get("item"), dict) else {}
    return str(item.get("role", "UNKNOWN")).upper()
