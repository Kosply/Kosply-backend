"""History routes: stored session reads (shared tables first, checkpointer fallback)."""

from fastapi import APIRouter, Depends, Request

from app.agent.memory import load_history
from app.api.shared import _thread, assert_thread_ownership
from app.core.security import require_internal_key
from .schemas import HistoryMessage, HistoryResponse

# This route returns a full transcript, so it requires the server's key.
router = APIRouter(dependencies=[Depends(require_internal_key)])

# The system prompt is the agent's whole policy and tool contract. The
# compaction summary is model-generated from untrusted content and was being
# persisted as a SystemMessage, i.e. promoted above user trust inside the graph.
_HIDDEN_ROLES = {"system"}


@router.get("/ai/history/{conversation_id}", response_model=HistoryResponse)
async def history(
    conversation_id: str,
    request: Request,
    user_id: str | None = None,
) -> HistoryResponse:
    """Stored messages of a session: shared tables first, checkpointer fallback."""
    if user_id:
        await assert_thread_ownership(request.app, conversation_id, user_id)
    stored_rows = await load_history(conversation_id)
    if stored_rows:
        return HistoryResponse(
            conversation_id=conversation_id,
            messages=[
                HistoryMessage(**row)
                for row in stored_rows
                if str(row.get("role", "")).lower() not in _HIDDEN_ROLES
            ],
        )
    graph = request.app.state.graph
    snapshot = await graph.aget_state(_thread(conversation_id))
    stored = snapshot.values.get("messages", []) or []
    messages = [
        HistoryMessage(
            role=getattr(m, "type", "unknown"),
            content=m.content if isinstance(getattr(m, "content", ""), str) else str(m.content),
        )
        for m in stored
        if getattr(m, "type", "") not in _HIDDEN_ROLES
    ]
    return HistoryResponse(conversation_id=conversation_id, messages=messages)
