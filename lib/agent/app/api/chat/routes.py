"""Chat routes: turns, SSE streams, approval resumes."""

import json

from fastapi import APIRouter, Request
from langchain_core.messages import HumanMessage
from langgraph.types import Command
from sse_starlette.sse import EventSourceResponse

from app.agent.memory import sync_turn
from app.agent.policy import check_user_message, reply_for
from app.api.shared import (
    _extract_callbacks,
    _final_answer,
    _raise_if_interrupted,
    _thread,
)
from app.core.config import settings
from app.core.errors import AgentError, ApprovalRequired, ModelError
from app.core.limits import run_guarded, stream_guarded
from .schemas import ChatRequest, ChatResponse, ResumeRequest
from .streaming import stream_chat_events

router = APIRouter()


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
                    "ui_state": req.ui_state or {},
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
    return ChatResponse(
        conversation_id=req.conversation_id,
        answer=answer,
        callbacks=_extract_callbacks(result),
    )


@router.post("/ai/chat/stream")
async def chat_stream(req: ChatRequest, request: Request) -> EventSourceResponse:
    """One chat turn as SSE (`token` / `thinking` / `callback` / `interrupt` / `done`)."""
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
                ui_state=req.ui_state,
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
    return ChatResponse(
        conversation_id=req.conversation_id,
        answer=answer,
        callbacks=_extract_callbacks(result),
    )
