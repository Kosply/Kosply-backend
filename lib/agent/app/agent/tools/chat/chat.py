"""Negotiation tools: read COD history and send as the user (approved only).

Flow: catalog detail -> read -> click chat -> AI negotiates. The model reads
the room, drafts/offers in its answer, and — after human approval — sends
via `send_chat_message` (sender comes from graph state, never invented).
"""

from typing import Annotated

import httpx
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from app.core.config import settings
from app.core.errors import ToolError


@tool
def read_conversation(conversation_id: str) -> str:
    """Read COD chat history (oldest first) to negotiate with context."""
    try:
        resp = httpx.get(
            f"{settings.kosply_server_url}/api/internal/conversations/{conversation_id}/messages",
            timeout=10.0,
        )
        resp.raise_for_status()
    except Exception as exc:
        raise ToolError(f"conversation read failed: {exc}") from exc
    return str(resp.json())


@tool
def send_chat_message(conversation_id: str, text: str,
                      state: Annotated[dict, InjectedState()] = None) -> str:
    """Send a COD chat message as the user. Requires human approval."""
    body = (text or "").strip()
    if not body:
        return "Empty message — tell the user to provide the offer text first."
    sender = ((state or {}).get("user_id") or "").strip()
    if not sender:
        return "No user in session — cannot send."
    try:
        resp = httpx.post(
            f"{settings.kosply_server_url}/api/internal/conversations/{conversation_id}/messages",
            json={"senderId": sender, "message": {"text": body}},
            timeout=10.0,
        )
        resp.raise_for_status()
    except Exception as exc:
        raise ToolError(f"chat send failed: {exc}") from exc
    return str(resp.json())
