"""Basic catalog tools (read-only). They call the Kosply server internal
HTTP API — never the database directly (monorepo `lib/` rule).
"""

from langchain_core.tools import tool

from app.core.errors import ToolError
from app.core.http import server_get


@tool
def search_catalog(query: str, max_price: int | None = None, category: str | None = None) -> str:
    """Search the second-hand catalog by keyword, optionally capped by price/category.

    Use it to show the user what is on screen-worthy: "liat list katalog".
    Price/category filter here (server returns the raw list).
    """
    try:
        resp = server_get("/api/internal/products/search", params={"q": query})
        resp.raise_for_status()
    except Exception as exc:
        raise ToolError(f"catalog search failed: {exc}") from exc
    data = resp.json() if isinstance(resp.json(), dict) else {}
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    if max_price is not None:
        items = [i for i in items
                 if isinstance(i.get("price"), (int, float)) and i["price"] <= max_price]
    if category:
        wanted = str(category).strip().lower()
        items = [i for i in items
                 if str(i.get("category") or "").strip().lower() == wanted]
    return str({"status": "ok", "items": items})


@tool
def get_product_detail(product_id: str) -> str:
    """Get one product (price, stock, location, seller) by its id."""
    try:
        resp = server_get(f"/api/internal/products/{product_id}")
        resp.raise_for_status()
    except Exception as exc:
        raise ToolError(f"product detail failed: {exc}") from exc
    return str(resp.json())
