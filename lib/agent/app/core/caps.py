"""Capacity guards: body-size cap, bounded model runs, timeouts.

Three independent knobs keep one slow/large request from hurting the rest:
oversized bodies are rejected before parsing, concurrent model runs are
capped (overflow gets 503, never a hung queue), and each run has a hard
ceiling that surfaces as 504.
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from starlette.responses import JSONResponse

from app.core.errors import ModelTimeout


def body_cap_middleware(max_bytes: int):
    """Build ASGI middleware rejecting oversized bodies with 413."""

    async def middleware(request, call_next):
        try:
            length = int(request.headers.get("content-length", "0") or "0")
        except ValueError:
            length = 0
        if length > max_bytes:
            return JSONResponse(
                status_code=413,
                content={"status": "error", "code": "BODY_TOO_LARGE",
                         "message": f"Body over {max_bytes} bytes."},
            )
        return await call_next(request)

    return middleware


async def run_guarded(
    semaphore: asyncio.Semaphore,
    operation: Callable[[], Awaitable[Any]],
    *,
    queue_timeout_s: float,
    run_timeout_s: float,
) -> Any:
    """Run one model call under capacity guards.

    Waits `queue_timeout_s` for a slot (else 503 ServerBusy), then runs at
    most `run_timeout_s` (else ModelTimeout -> 504).
    """
    from app.core.errors import ServerBusy

    try:
        await asyncio.wait_for(semaphore.acquire(), timeout=queue_timeout_s)
    except asyncio.TimeoutError as exc:
        raise ServerBusy() from exc
    try:
        return await asyncio.wait_for(operation(), timeout=run_timeout_s)
    except asyncio.TimeoutError as exc:
        raise ModelTimeout() from exc
    finally:
        semaphore.release()


async def stream_guarded(
    semaphore: asyncio.Semaphore,
    events: AsyncIterator[dict],
    *,
    queue_timeout_s: float,
) -> AsyncIterator[dict]:
    """Hold one capacity slot for the whole SSE stream (released at the end)."""
    from app.core.errors import ServerBusy

    try:
        await asyncio.wait_for(semaphore.acquire(), timeout=queue_timeout_s)
    except asyncio.TimeoutError as exc:
        raise ServerBusy() from exc
    try:
        async for event in events:
            yield event
    finally:
        semaphore.release()
