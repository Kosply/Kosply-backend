"""Shared route helpers: thread config, answer extraction, callbacks, interrupts."""

import json

from app.core.errors import ApprovalRequired


def _thread(conversation_id: str) -> dict:
    """LangGraph config: thread_id is the resume key (== ai_conversations.id)."""
    return {"configurable": {"thread_id": conversation_id}}


def _final_answer(result: dict) -> str:
    """Extract the last assistant text from an invoke result."""
    for msg in reversed(result.get("messages", [])):
        if getattr(msg, "type", "") == "ai" and getattr(msg, "content", ""):
            content = msg.content
            return content if isinstance(content, str) else str(content)
    return ""


def _extract_callbacks(result: dict) -> list:
    """Collect perform_callback payloads from a finished turn for Flutter."""
    callbacks = []
    for msg in result.get("messages", []):
        if getattr(msg, "type", "") != "tool" or getattr(msg, "name", "") != "perform_callback":
            continue
        try:
            payload = json.loads(msg.content) if isinstance(msg.content, str) else {}
        except (ValueError, TypeError):
            continue
        if isinstance(payload, dict) and payload.get("callback"):
            callbacks.append({"callback": payload["callback"], "args": payload.get("args", {})})
    return callbacks


def _raise_if_interrupted(result: dict) -> None:
    """Convert a paused graph into HTTP 409 for the approval UI."""
    if isinstance(result, dict) and result.get("__interrupt__"):
        payload = [getattr(i, "value", None) for i in result["__interrupt__"]]
        raise ApprovalRequired(payload)
