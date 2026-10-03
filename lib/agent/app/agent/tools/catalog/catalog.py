"""Basic catalog tools (read-only). They call the Kosply server internal
HTTP API — never the database directly (monorepo `lib/` rule).
"""

from langchain_core.tools import tool

from app.core.errors import ToolError
from app.core.http import server_get

# Ceiling on returned rows. The model has to read every field of every item, so a
# wide page is mostly context the user cannot use.
MAX_RESULTS = 30


def _matches_category(item: dict, category: str) -> bool:
    """Substring match, not equality.

    `Product.category` is free text typed by the seller ("laptop", "Laptop",
    "notebook", or blank), so an exact comparison meant any category the model
    reasoned its way to -- "elektronik", "alat elektronik" -- matched nothing and
    the tool reported an empty catalog. Substring matching in both directions
    catches the seller's own wording as well as a broader category word.
    """
    actual = str(item.get("category") or "").strip().lower()
    wanted = category.strip().lower()
    if not actual or not wanted:
        return False
    return wanted in actual or actual in wanted


@tool
def search_catalog(query: str, max_price: int | None = None, category: str | None = None) -> str:
    """Search the second-hand catalog by keyword, optionally capped by price/category.

    Use it for anything about what is actually for sale -- the catalog changes
    constantly and is not something you remember, so always call this rather
    than recalling listings. Prefer a short, common `query`: matching is partial
    against the title and description, so "laptop" finds "ASUS X441" but the full
    spec string will not.
    """
    try:
        resp = server_get(
            "/api/internal/products/search",
            params={"q": query, "limit": MAX_RESULTS},
        )
        resp.raise_for_status()
    except Exception as exc:
        raise ToolError(f"catalog search failed: {exc}") from exc
    data = resp.json() if isinstance(resp.json(), dict) else {}
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    if max_price is not None:
        items = [i for i in items
                 if isinstance(i.get("price"), (int, float)) and i["price"] <= max_price]
    if category:
        items = [i for i in items if _matches_category(i, category)]
    # Only ACTIVE listings come back from the server, so the model should never
    # have to reason about availability. Say so explicitly anyway, rather than
    # letting an empty list read as "Kosply has nothing".
    return str({"status": "ok", "query": query, "count": len(items), "items": items})


@tool
def get_product_detail(product_id: str) -> str:
    """Get one product (description, price, stock, status, location, seller) by its id.

    Use the `id` returned by `search_catalog` verbatim. Do not invent one.
    """
    if not str(product_id or "").strip():
        raise ToolError("product_id is required; call search_catalog first")
    try:
        resp = server_get(f"/api/internal/products/{product_id}")
        resp.raise_for_status()
    except Exception as exc:
        raise ToolError(f"product detail failed: {exc}") from exc
    return str(resp.json())