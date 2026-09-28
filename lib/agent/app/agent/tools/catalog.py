"""Basic catalog tools (read-only). They call the Kosply server internal
HTTP API — never the database directly (monorepo `lib/` rule).
"""

import httpx
from langchain_core.tools import tool

from app.core.config import settings
from app.core.errors import ToolError


@tool
def search_catalog(query: str) -> str:
    """Search the second-hand catalog by keyword. Returns matching products."""
    try:
        resp = httpx.get(
            f"{settings.kosply_server_url}/api/internal/products/search",
            params={"q": query},
            timeout=10.0,
        )
        resp.raise_for_status()
    except Exception as exc:
        raise ToolError(f"catalog search failed: {exc}") from exc
    return str(resp.json())


@tool
def get_product_detail(product_id: str) -> str:
    """Get one product (price, stock, location, seller) by its id."""
    try:
        resp = httpx.get(
            f"{settings.kosply_server_url}/api/internal/products/{product_id}",
            timeout=10.0,
        )
        resp.raise_for_status()
    except Exception as exc:
        raise ToolError(f"product detail failed: {exc}") from exc
    return str(resp.json())
