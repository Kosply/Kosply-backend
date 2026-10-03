"""SSE streaming helpers: token/thinking stream + interrupt events from the graph.

Events emitted:
- `token`     — one LLM answer chunk (`{"text": ...}`).
- `thinking`  — one reasoning-model thinking chunk (`{"text": ...}`), kept
  separate so Flutter can render it collapsed/hidden.
- `callback`  — one UI action payload (`{"callback": ..., "args": {...}}`)
  for Flutter to execute immediately.
- `interrupt` — graph paused for approval (`{"pending": [...]}`); the client
  must call POST /ai/chat/resume. The stream ends right after this event.
- `done`      — turn finished.
"""

import asyncio

import json
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import HumanMessage


def _payload(data: Any) -> str:
    """Pre-serialize SSE data (safe across sse-starlette versions)."""
    return json.dumps(data, default=str)


_THINKING_BLOCK_TYPES = frozenset({"reasoning", "thinking", "redacted_thinking"})


def _split_block(block: Any) -> tuple:
    """Split one content block into (thinking_text, answer_text)."""
    if not isinstance(block, dict):
        return "", ""
    if block.get("type") == "non_standard":
        inner = block.get("value")
        return _split_block(inner) if isinstance(inner, dict) else ("", "")
    if block.get("type") in _THINKING_BLOCK_TYPES:
        text = block.get("thinking") or block.get("reasoning") or block.get("text") or ""
        return text, ""
    if block.get("type") == "text":
        return "", block.get("text") or ""
    return "", ""


def split_thinking(chunk: Any) -> tuple:
    """Split a message chunk into (thinking_text, answer_text).

    Newer reasoning models stream thinking separately from the answer.
    langchain-core normalizes provider shapes into `content_blocks`
    (reasoning/thinking vs text blocks); OpenAI-compatible endpoints also
    surface `reasoning_content` in `additional_kwargs`.
    """
    thinking, answer = [], []
    blocks = getattr(chunk, "content_blocks", None) or []
    if blocks:
        for block in blocks:
            think_part, answer_part = _split_block(block)
            if think_part:
                thinking.append(think_part)
            if answer_part:
                answer.append(answer_part)
    else:
        content = getattr(chunk, "content", "")
        if isinstance(content, str):
            if content:
                answer.append(content)
        elif isinstance(content, list):
            answer.extend(p for p in content if isinstance(p, str) and p)
    extra = getattr(chunk, "additional_kwargs", None) or {}
    if extra.get("reasoning_content") and extra["reasoning_content"] not in "".join(thinking):
        thinking.append(extra["reasoning_content"])
    return "".join(thinking), "".join(answer)


async def stream_chat_events(
    graph: Any, *, message: str, user_id: str, conversation_id: str,
    role: str = "UNKNOWN", ui_state: dict | None = None,
    recursion_limit: int = 40,
) -> AsyncIterator[dict]:
    """Yield SSE-ready dicts for EventSourceResponse.

    Every stream now ends with exactly one terminal event. Previously a failure
    after the first token propagated out of the generator, sse-starlette tore the
    connection down, and the client — which had already seen HTTP 200 and some
    tokens — could not tell "finished" from "crashed", so it waited forever.
    """
    config = {
        "configurable": {"thread_id": conversation_id},
        # The ReAct loop was bounded only by LangGraph's implicit default, and
        # a GraphRecursionError surfaced as a 500 with the raw message.
        "recursion_limit": recursion_limit,
    }
    agen = graph.astream(
        {"messages": [HumanMessage(content=message)], "user_id": user_id,
         "user_role": role, "ui_state": ui_state or {}},
        config,
        stream_mode=["messages", "updates"],
    )
    try:
        async for mode, chunk in agen:
            if mode == "messages":
                token, _meta = chunk
                thinking, text = split_thinking(token)
                if thinking:
                    yield {"event": "thinking", "data": _payload({"text": thinking})}
                if text:
                    yield {"event": "token", "data": _payload({"text": text})}
            elif mode == "updates" and isinstance(chunk, dict):
                if "__interrupt__" in chunk:
                    pending = [getattr(i, "value", None) for i in chunk["__interrupt__"]]
                    yield {"event": "interrupt", "data": _payload({"pending": pending})}
                    # The approval is a terminal state for this request, not a
                    # failure: `interrupt` already told the client what to do.
                    yield {"event": "done", "data": _payload({"ok": True, "awaitingApproval": True})}
                    return
                for callback in _updates_callbacks(chunk):
                    yield {"event": "callback", "data": _payload(callback)}
    except asyncio.CancelledError:
        # Client went away mid-stream. Close the upstream generator explicitly
        # so the graph run stops and its in-flight slot is released; relying on
        # GC leaked permits and kept orphaned runs (and their LLM spend) alive.
        await _safe_aclose(agen)
        raise
    except Exception:
        # Always tell the client why the stream ended.
        yield {"event": "error", "data": _payload({"message": "stream failed"})}
        yield {"event": "done", "data": _payload({"ok": False})}
        return
    finally:
        # If this raises, the terminal `done` below never runs and the client
        # hangs on a truncated stream - the exact failure this module exists to
        # prevent. Cleanup must never be able to eat the terminal event.
        await _safe_aclose(agen)
    yield {"event": "done", "data": _payload({"ok": True})}


async def _safe_aclose(agen) -> None:
    """Close an async generator, swallowing cleanup errors."""
    aclose = getattr(agen, "aclose", None)
    if aclose is None:
        return
    try:
        await aclose()
    except Exception as exc:  # noqa: BLE001 - cleanup must not mask the result
        print(f"[agent] stream cleanup error: {exc!r}")


def _updates_callbacks(chunk: dict) -> list:
    """Collect perform_callback payloads from a stream update chunk."""
    found = []
    for update in chunk.values():
        messages = update.get("messages", []) if isinstance(update, dict) else []
        for msg in messages:
            if getattr(msg, "type", "") != "tool" or getattr(msg, "name", "") != "perform_callback":
                continue
            try:
                payload = json.loads(msg.content) if isinstance(msg.content, str) else {}
            except (ValueError, TypeError):
                continue
            if isinstance(payload, dict) and payload.get("callback"):
                found.append({"callback": payload["callback"], "args": payload.get("args", {})})
    return found
