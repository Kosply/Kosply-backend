"""Sensitive tools: they only run after the user approves them
(see `human_approval` in `graph.py` + POST /ai/chat/resume)."""

from typing import Annotated

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from app.core.config import settings
from app.core.http import server_post
from app.core.errors import ToolError


@tool
def request_seller_contact(
    product_id: str,
    message: str,
    state: Annotated[dict, InjectedState()],
) -> str:
    """Open the product chat and send this message as the buyer.

    Requires user approval. The message is stored in the seller's chat room.
    """
    buyer_id = (state or {}).get("user_id", "")
    try:
        resp = server_post(
            "/api/internal/contact-requests",
            json={"productId": product_id, "buyerId": buyer_id, "message": message},
        )
        resp.raise_for_status()
    except Exception as exc:
        raise ToolError(f"contact request failed: {exc}") from exc
    return str(resp.json())
