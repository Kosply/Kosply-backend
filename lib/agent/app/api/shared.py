"""Shared route helpers: thread config, answer extraction, callbacks, interrupts."""

import asyncio
import json
import time

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


def _pending_interrupts(snapshot) -> list:
    """Pending approval payloads from a state snapshot (values + tasks)."""
    found = []
    values = getattr(snapshot, "values", None) or {}
    if isinstance(values, dict):
        for item in values.get("__interrupt__", []) or []:
            found.append(getattr(item, "value", None))
    for task in getattr(snapshot, "tasks", None) or []:
        for item in getattr(task, "interrupts", None) or []:
            found.append(getattr(item, "value", None))
    return found


async def _wait_for_resolution(graph, conversation_id: str, timeout_s: float) -> dict:
    """Block until the pending approval resolves or the timeout elapses.

    Event-based: returns the moment the interrupt clears (no fixed waiting).
    After clearance, keeps polling briefly for the follow-up AI answer so the
    response carries both. Always reports `remainingS` for chaining leftovers.
    """
    config = _thread(conversation_id)
    cap = min(max(timeout_s, 1.0), 1500.0)
    deadline = time.monotonic() + cap
    snapshot = await graph.aget_state(config)
    if not _pending_interrupts(snapshot):
        return {"status": "noop", "answer": "", "remainingS": int(cap)}
    answer = ""
    while True:
        await asyncio.sleep(1.0)
        snapshot = await graph.aget_state(config)
        remaining = max(0, int(deadline - time.monotonic()))
        if _pending_interrupts(snapshot):
            if time.monotonic() >= deadline:
                return {"status": "timeout", "answer": "", "remainingS": 0}
            continue
        messages = (getattr(snapshot, "values", None) or {}).get("messages", []) or []
        for msg in reversed(messages):
            if getattr(msg, "type", "") == "ai" and getattr(msg, "content", ""):
                content = msg.content
                answer = content if isinstance(content, str) else str(content)
                break
        if answer or time.monotonic() >= deadline:
            status = "resolved" if answer else "timeout"
            return {"status": status, "answer": answer, "remainingS": remaining}
