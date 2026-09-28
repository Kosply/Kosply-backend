"""HTTP routes: health + basic AI chat (invoke, SSE stream, resume, history)."""

import json

from fastapi import APIRouter, Request
from langchain_core.messages import HumanMessage
from langgraph.types import Command
from sse_starlette.sse import EventSourceResponse

from app.agent.memory.history_store import load_history, sync_turn
from app.agent.policy.guard import check_user_message, reply_for
from app.core.caps import run_guarded, stream_guarded
from app.core.config import settings
from app.core.errors import AgentError, ApprovalRequired, ModelError
from .schemas import ChatRequest, ChatResponse, HistoryMessage, HistoryResponse, ResumeRequest
from .streaming import stream_chat_events

router = APIRouter()


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


def _raise_if_interrupted(result: dict) -> None:
    """Convert a paused graph into HTTP 409 for the approval UI."""
    if isinstance(result, dict) and result.get("__interrupt__"):
        payload = [getattr(i, "value", None) for i in result["__interrupt__"]]
        raise ApprovalRequired(payload)


@router.get("/health")
async def health() -> dict:
    """Liveness probe."""
    return {"status": "ok", "service": "kosply-agent"}


@router.get("/readyz")
async def ready(request: Request) -> dict:
    """Readiness probe: 200 when the persistence backend answers."""
    from fastapi.responses import JSONResponse

    from app.agent.memory.checkpointer import describe_saver
    from app.core.dsn import pg_dsn

    backend = describe_saver(request.app.state.saver)
    if backend == "memory":
        return {"status": "degraded", "checkpointer": backend}
    try:
        from psycopg import AsyncConnection

        conn = await AsyncConnection.connect(pg_dsn(settings.database_url or ""))
        try:
            await conn.execute("SELECT 1")
        finally:
            await conn.close()
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"status": "down", "checkpointer": backend},
        )
    return {"status": "ok", "checkpointer": backend}


@router.post("/ai/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request) -> ChatResponse:
    """One chat turn (non-streaming). 409 when a tool needs approval."""
    verdict = check_user_message(req.message)
    if not verdict.allowed:
        reply = reply_for(verdict.reason)
        await sync_turn(req.conversation_id, req.user_id, req.message, reply)
        return ChatResponse(conversation_id=req.conversation_id, answer=reply)
    graph = request.app.state.graph
    try:
        result = await run_guarded(
            request.app.state.inflight,
            lambda: graph.ainvoke(
                {
                    "messages": [HumanMessage(content=req.message)],
                    "user_id": req.user_id,
                    "user_role": req.role,
                },
                _thread(req.conversation_id),
            ),
            queue_timeout_s=settings.queue_timeout_s,
            run_timeout_s=settings.model_timeout_s,
        )
    except AgentError:
        raise
    except Exception as exc:
        raise ModelError(str(exc)) from exc
    _raise_if_interrupted(result)
    answer = _final_answer(result)
    await sync_turn(req.conversation_id, req.user_id, req.message, answer)
    return ChatResponse(conversation_id=req.conversation_id, answer=answer)


@router.post("/ai/chat/stream")
async def chat_stream(req: ChatRequest, request: Request) -> EventSourceResponse:
    """One chat turn as SSE (`token` / `thinking` / `interrupt` / `done` events)."""
    verdict = check_user_message(req.message)
    if not verdict.allowed:
        reply = reply_for(verdict.reason)
        await sync_turn(req.conversation_id, req.user_id, req.message, reply)

        async def _rejected():
            """SSE refusal: single explainer token, then done."""
            yield {"event": "token", "data": json.dumps({"text": reply})}
            yield {"event": "done", "data": json.dumps({"ok": True})}

        return EventSourceResponse(_rejected())
    graph = request.app.state.graph
    return EventSourceResponse(
        stream_guarded(
            request.app.state.inflight,
            stream_chat_events(
                graph,
                message=req.message,
                user_id=req.user_id,
                conversation_id=req.conversation_id,
                role=req.role,
            ),
            queue_timeout_s=settings.queue_timeout_s,
        )
    )


@router.post("/ai/chat/resume", response_model=ChatResponse)
async def resume(req: ResumeRequest, request: Request) -> ChatResponse:
    """Answer a pending approval: approve runs the tool, reject cancels it."""
    graph = request.app.state.graph
    try:
        result = await run_guarded(
            request.app.state.inflight,
            lambda: graph.ainvoke(
                Command(resume="approve" if req.approve else "reject"),
                _thread(req.conversation_id),
            ),
            queue_timeout_s=settings.queue_timeout_s,
            run_timeout_s=settings.model_timeout_s,
        )
    except AgentError:
        raise
    except Exception as exc:
        raise ModelError(str(exc)) from exc
    _raise_if_interrupted(result)
    answer = _final_answer(result)
    await sync_turn(req.conversation_id, req.user_id, "", answer)
    return ChatResponse(conversation_id=req.conversation_id, answer=answer)


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
