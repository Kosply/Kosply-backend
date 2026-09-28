"""Sensitive tools: they only run after the user approves them
(see `human_approval` in `graph.py` + POST /ai/chat/resume)."""

from langchain_core.tools import tool


@tool
def request_seller_contact(product_id: str, message: str) -> str:
    """Ask a seller to contact you about a product. Requires user approval."""
    return (
        f"Contact request queued for product {product_id}: {message!r}. "
        "TODO(server): deliver via POST /internal/contact-requests."
    )
