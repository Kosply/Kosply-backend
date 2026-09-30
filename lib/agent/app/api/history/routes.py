"""History routes: stored session reads (shared tables first, checkpointer fallback)."""

from fastapi import APIRouter, Request

from app.agent.memory import load_history
from app.api.shared import _thread
from .schemas import HistoryMessage, HistoryResponse

router = APIRouter()


@router.get("/ai/history/{conversation_id}", response_model=HistoryResponse)
async def history(conversation_id: str, request: Request) -> HistoryResponse:
    """Stored messages of a session: shared tables first, checkpointer fallback."""
    stored_rows = await load_history(conversation_id)
    if stored_rows:
        return HistoryResponse(
            conversation_id=conversation_id,
            messages=[HistoryMessage(**row) for row in stored_rows],
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
    ]
    return HistoryResponse(conversation_id=conversation_id, messages=messages)
