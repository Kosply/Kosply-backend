"""Shared chat-turn shaping for the JSON route and the SSE route.

Photos travel beside the text message. The 4000-character message cap
applies to the caption only.
"""

from langchain_core.messages import HumanMessage

from app.agent.listing.card import listing_message_content
from app.agent.policy import check_user_message
from app.api.chat.schemas import ChatRequest


def precheck(req: ChatRequest):
    """Return a rejection verdict, or None when the turn may run.

    A photo turn and a price/stock turn may omit the caption. A chatbot
    turn still needs text, and a caption is still screened for injection.
    """
    text = req.message or ""
    completing = req.price is not None and req.stock is not None
    if not text.strip() and (req.image_urls or completing):
        return None
    verdict = check_user_message(text)
    if verdict.allowed:
        return None
    return verdict


def listing_mode_of(req: ChatRequest) -> str:
    """Select the graph branch for this turn. Photos win over price."""
    if req.image_urls:
        return "photos"
    if req.price is not None and req.stock is not None:
        return "price"
    return "chat"


def graph_input(req: ChatRequest) -> dict:
    """State delta for one invoke. Mode is always set, so a prior turn cannot stick."""
    mode = listing_mode_of(req)
    text = (req.message or "").strip()
    if mode == "photos":
        human = HumanMessage(content=listing_message_content(text, req.image_urls))
    else:
        human = HumanMessage(content=text or "Harga dan stok.")
    return {
        "messages": [human],
        "user_id": req.user_id,
        "user_role": req.role,
        "ui_state": req.ui_state or {},
        "image_urls": list(req.image_urls) if mode == "photos" else [],
        "listing_price": req.price,
        "listing_stock": req.stock,
        "listing_mode": mode,
    }


def listing_from_result(mode: str, result: dict) -> dict | None:
    """Return the card only for the turn that produced it.

    A later chatbot turn on the same thread must not echo the stored card.
    """
    if mode not in ("photos", "price"):
        return None
    card = result.get("listing_card") if isinstance(result, dict) else None
    if not isinstance(card, dict) or not card.get("title"):
        return None
    return card
