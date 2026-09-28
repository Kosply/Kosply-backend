"""SSE streaming helpers: token/thinking stream + interrupt events from the graph.

Events emitted:
- `token`     — one LLM answer chunk (`{"text": ...}`).
- `thinking`  — one reasoning-model thinking chunk (`{"text": ...}`), kept
  separate so Flutter can render it collapsed/hidden.
- `interrupt` — graph paused for approval (`{"pending": [...]}`); the client
  must call POST /ai/chat/resume. The stream ends right after this event.
- `done`      — turn finished.
"""

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
    graph: Any, *, message: str, user_id: str, conversation_id: str
) -> AsyncIterator[dict]:
    """Yield SSE-ready dicts for EventSourceResponse."""
    config = {"configurable": {"thread_id": conversation_id}}
    async for mode, chunk in graph.astream(
        {"messages": [HumanMessage(content=message)], "user_id": user_id},
        config,
        stream_mode=["messages", "updates"],
    ):
        if mode == "messages":
            token, _meta = chunk
            thinking, text = split_thinking(token)
            if thinking:
                yield {"event": "thinking", "data": _payload({"text": thinking})}
            if text:
                yield {"event": "token", "data": _payload({"text": text})}
        elif mode == "updates" and isinstance(chunk, dict) and "__interrupt__" in chunk:
            pending = [getattr(i, "value", None) for i in chunk["__interrupt__"]]
            yield {"event": "interrupt", "data": _payload({"pending": pending})}
            return
    yield {"event": "done", "data": _payload({"ok": True})}
