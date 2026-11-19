"""Propose the seller add-product form. The phone writes it after approval.

The tool does not publish a listing and does not touch the catalog. It pauses
with the other sensitive tools so the student sees a preview first.
"""

import json
import re

from langchain_core.tools import tool

from app.agent.listing.card import CATEGORY_MAX, DESCRIPTION_MAX, MAX_PRICE_RP, TITLE_MAX
from app.core.errors import ToolError

_DIGITS = re.compile(r"[^0-9]")


def _price(value) -> int:
    """Integer rupiah. A bool, a fraction, or an empty string is not a price."""
    if isinstance(value, bool):
        raise ToolError("price must be an integer rupiah amount")
    if isinstance(value, float):
        if not value.is_integer():
            raise ToolError("price must be an integer rupiah amount")
        value = int(value)
    elif isinstance(value, str):
        digits = _DIGITS.sub("", value)
        if not digits:
            raise ToolError("price must be an integer rupiah amount")
        value = int(digits)
    if not isinstance(value, int):
        raise ToolError("price must be an integer rupiah amount")
    if value < 1 or value > MAX_PRICE_RP:
        raise ToolError("price is out of range")
    return value


def _text(value, field: str, limit: int) -> str:
    text = str(value or "").strip()
    if not text:
        raise ToolError(f"{field} is required")
    return text[:limit]


@tool
def fill_product_form(title: str, price: int, description: str, category: str) -> str:
    """Propose the seller add-product form: name, rupiah price, description, category.

    The app shows a preview and writes the four fields only after the student
    approves. Do not say the form was filled before this tool returns. Do not
    publish the listing. price is an integer count of rupiah. category is one
    seeded catalog name, or Lainnya.
    """
    payload = {
        "status": "ok",
        "title": _text(title, "title", TITLE_MAX),
        "price": _price(price),
        "description": _text(description, "description", DESCRIPTION_MAX),
        "category": _text(category, "category", CATEGORY_MAX),
    }
    return json.dumps(payload, ensure_ascii=False)
