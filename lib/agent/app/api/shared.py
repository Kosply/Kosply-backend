"""Shared route helpers: thread config, answer extraction, callbacks, interrupts."""

import asyncio
import json
import time

from app.core.errors import ApprovalRequired
from app.core.errors.errors import AgentError


class OwnershipCheckUnavailable(AgentError):
    """The ownership check could not run (pool exhausted, DB down) - HTTP 503."""

    status_code = 503

    def __init__(self) -> None:
        """Fixed message: never discloses infrastructure detail."""
        super().__init__("conversation ownership could not be verified")


class ConversationNotOwned(AgentError):
    """The conversation exists but belongs to a different user (HTTP 404).

    Reported as 404 rather than 403 so the response does not confirm that the
    id exists.
    """

    status_code = 404

    def __init__(self) -> None:
        """Fixed message: never discloses the real owner."""
        super().__init__("conversation not found")


async def assert_thread_ownership(app, conversation_id: str, user_id: str) -> None:
    """Refuse to touch a thread owned by somebody else.

    ``thread_id`` is the request body's ``conversation_id`` and was used with no
    ownership check at all, so any caller could read another user's transcript,
    inject turns into their thread, and — worst — satisfy the human-approval
    interrupt on their behalf via ``/ai/chat/resume``. The interrupt *is* the
    consent gate, so that last one is a full account-takeover primitive.

    An unknown id is allowed: the turn creates it for this user. A known id
    owned by someone else is refused.
    """
    if not conversation_id or not user_id:
        return
    db = getattr(app.state, "db", None)
    if db is None:
        # No ownership pool: the *server* is the authority and it checks
        # ownership in Prisma before proxying (services/ai/ai.service.js), so
        # there is nothing to compare against here. The API is also unauthenticated
        # without INTERNAL_API_KEY, so this path is not publicly reachable.
        return
    try:
        # `AsyncConnectionPool` exposes `connection()`; there is no `acquire()`.
        # The previous code called the missing method, so the AttributeError was
        # caught by the bare `except` below and the check never ran at all.
        async with db.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    'SELECT "userId" FROM ai_conversations WHERE id = %s',
                    (conversation_id,),
                )
                row = await cur.fetchone()
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see below
        # A pool timeout, a dropped connection or a missing table must NOT
        # silently skip the check: that turns the ownership guard into a
        # one-line bypass. Fail closed with a 503 and log loudly.
        print(f"[agent] ownership check failed, refusing: {exc!r}")
        raise OwnershipCheckUnavailable() from exc
    if row and row[0] and str(row[0]) != str(user_id):
        raise ConversationNotOwned()


def _thread(conversation_id: str, *, recursion_limit: int | None = None) -> dict:
    """LangGraph config: thread_id is the resume key (== ai_conversations.id).

    `recursion_limit` bounds the ReAct loop. Without it the graph relied on
    LangGraph's implicit default, and exceeding it raised GraphRecursionError,
    which the route's catch-all turned into a 500 carrying the raw message.
    """
    config: dict = {"configurable": {"thread_id": conversation_id}}
    if recursion_limit:
        config["recursion_limit"] = recursion_limit
    return config


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
