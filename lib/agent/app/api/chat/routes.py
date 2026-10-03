"""Chat routes: turns, SSE streams, approval resumes."""

import asyncio
import json

from fastapi import APIRouter, Depends, Request
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
    _wait_for_resolution,
    assert_thread_ownership,
)
from app.core.config import settings
from app.core.errors import AgentError, ApprovalRequired, ModelError, ServerBusy
from app.core.limits import run_guarded, stream_guarded
from app.core.security import require_internal_key
from .schemas import ChatRequest, ChatResponse, ResumeRequest, WaitResponse
from .streaming import stream_chat_events

# Every route is behind the server's shared secret. The agent used to be
# completely unauthenticated while published on 0.0.0.0:8000.
router = APIRouter(dependencies=[Depends(require_internal_key)])


@router.post("/ai/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request) -> ChatResponse:
    """One chat turn (non-streaming). 409 when a tool needs approval."""
    await assert_thread_ownership(request.app, req.conversation_id, req.user_id)
    req.check_ui_state()
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
                _thread(req.conversation_id, recursion_limit=settings.recursion_limit),
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
    await assert_thread_ownership(request.app, req.conversation_id, req.user_id)
    req.check_ui_state()
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
                recursion_limit=settings.recursion_limit,
            ),
            queue_timeout_s=settings.queue_timeout_s,
            run_timeout_s=settings.stream_timeout_s,
        )
    )


@router.post("/ai/chat/resume", response_model=ChatResponse)
async def resume(req: ResumeRequest, request: Request) -> ChatResponse:
    await assert_thread_ownership(request.app, req.conversation_id, req.user_id)
    """Answer a pending approval: approve runs the tool, reject cancels it."""
    graph = request.app.state.graph
    try:
        result = await run_guarded(
            request.app.state.inflight,
            lambda: graph.ainvoke(
                Command(resume="approve" if req.approve else "reject"),
                _thread(req.conversation_id, recursion_limit=settings.recursion_limit),
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


@router.get("/ai/wait/{conversation_id}", response_model=WaitResponse)
async def wait_approval(
    conversation_id: str,
    request: Request,
    timeout: float = 60.0,
    user_id: str | None = None,
) -> WaitResponse:
    """Wait for a pending user approval: resolves on event, else on timeout.

    Event-based (no fixed waiting): returns the moment the interrupt clears
    with `remainingS` leftovers; `timeout` seconds cap (1..1500). `noop` when
    nothing is pending. Needs background permission on the phone for long waits.
    """
    if user_id:
        await assert_thread_ownership(request.app, conversation_id, user_id)
    graph = request.app.state.graph
    waiters = getattr(request.app.state, "waiters", None)
    # Racy check-then-act: the old `locked()` peek could pass and then
    # `acquire()` blocked forever with no timeout and no disconnect escape.
    if waiters is not None:
        try:
            await asyncio.wait_for(waiters.acquire(), timeout=1.0)
        except asyncio.TimeoutError as exc:
            raise ServerBusy() from exc
    try:
        out = await _wait_for_resolution(graph, conversation_id, timeout)
    finally:
        if waiters is not None:
            waiters.release()
    return WaitResponse(conversation_id=conversation_id, **out)
