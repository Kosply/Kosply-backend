"""Negotiation tools: read COD history and send as the user (approved only).

Flow: catalog detail -> read -> click chat -> AI negotiates. The model reads
the room, drafts/offers in its answer, and — after human approval — sends
via `send_chat_message` (sender comes from graph state, never invented).
"""

from typing import Annotated

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from app.core.errors import ToolError
from app.core.http import server_get, server_post


def _session_user(state: dict | None) -> str:
    """The authenticated user from graph state (never from the model's text)."""
    return ((state or {}).get("user_id") or "").strip()


@tool
def read_conversation(conversation_id: str,
                      state: Annotated[dict, InjectedState()] = None) -> str:
    """Read COD chat history (oldest first) to negotiate with context."""
    # The server's membership gate requires `userId` as a query param
    # (internal.controller.js), so without this the call was a 400 even with a
    # valid key and the negotiator could never read the room it negotiates in.
    sender = _session_user(state)
    if not sender:
        return "No user in session — cannot read the conversation."
    try:
        resp = server_get(
            f"/api/internal/conversations/{conversation_id}/messages",
            params={"userId": sender},
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
    sender = _session_user(state)
    if not sender:
        return "No user in session — cannot send."
    try:
        resp = server_post(
            f"/api/internal/conversations/{conversation_id}/messages",
            json={"senderId": sender, "message": {"text": body}},
        )
        resp.raise_for_status()
    except Exception as exc:
        raise ToolError(f"chat send failed: {exc}") from exc
    return str(resp.json())