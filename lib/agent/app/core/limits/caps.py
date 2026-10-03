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


class BodyCapMiddleware:
    """Raw ASGI middleware that rejects oversized bodies with 413.

    The previous implementation trusted the ``Content-Length`` header, which a
    caller simply omits when using ``Transfer-Encoding: chunked``. The cap was
    therefore decorative, and the rate limiter downstream then buffered the whole
    body with ``await request.body()`` before any size check — so N concurrent
    chunked uploads could exhaust the process.

    This counts the bytes actually received and cuts the connection off as soon
    as the budget is gone, so the transfer framing does not matter. It has to be
    raw ASGI (not a ``call_next`` middleware) because that is the only level at
    which the ``receive`` channel can be wrapped.
    """

    def __init__(self, app, max_bytes: int) -> None:
        """Store the downstream app and the byte budget."""
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send) -> None:
        """Pass the request through, aborting once the budget is exceeded."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Cheap early reject when the caller bothered to declare a length.
        for key, value in scope.get("headers", ()):
            if key == b"content-length":
                try:
                    if int(value) > self.max_bytes:
                        await _send_413(send, self.max_bytes)
                        return
                except ValueError:
                    pass
                break

        state = {"received": 0, "exceeded": False}

        async def counting_receive():
            message = await receive()
            if message.get("type") == "http.request":
                state["received"] += len(message.get("body", b"") or b"")
                if state["received"] > self.max_bytes:
                    state["exceeded"] = True
                    # Tell the downstream app the client is gone. It raises while
                    # parsing; we then answer 413 instead of buffering further.
                    return {"type": "http.disconnect"}
            return message

        # Two distinct states, which must not be conflated:
        #   `responded` - any response has started (the except-branch needs this
        #                  so it does not send a SECOND response).
        #   `substituted` - *we* already sent the 413, so the app's own body
        #                  (usually a parse error) must be discarded.
        # Conflating them drops every legitimate response body.
        responded = False
        substituted = False

        async def guarded_send(message):
            nonlocal responded, substituted
            if message.get("type") == "http.response.start":
                responded = True
                if state["exceeded"]:
                    body = _body_413(self.max_bytes)
                    await send({
                        "type": "http.response.start",
                        "status": 413,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                        ],
                    })
                    await send({"type": "http.response.body", "body": body,
                                "more_body": False})
                    substituted = True
                    return
            elif substituted and message.get("type") == "http.response.body":
                # The app is still trying to send its error body after we
                # already answered. Dropping it avoids
                # "Unexpected ASGI message ... after response already completed".
                return
            await send(message)

        try:
            await self.app(scope, counting_receive, guarded_send)
        except Exception:
            if state["exceeded"]:
                # The downstream app aborted because the body was cut off.
                if not responded:
                    await _send_413(send, self.max_bytes)
                return
            raise


def _body_413(max_bytes: int) -> bytes:
    """JSON body for a 413 response."""
    return (
        b'{"status":"error","code":"BODY_TOO_LARGE","message":"Body over '
        + str(max_bytes).encode()
        + b' bytes."}'
    )


async def _send_413(send, max_bytes: int) -> None:
    """Write a complete 413 response."""
    body = _body_413(max_bytes)
    await send({
        "type": "http.response.start",
        "status": 413,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
        ],
    })
    await send({"type": "http.response.body", "body": body, "more_body": False})


def body_cap_middleware(max_bytes: int):
    """Factory kept for the ``app.add_middleware`` call site in main.py."""
    return BodyCapMiddleware


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
    run_timeout_s: float = 300.0,
) -> AsyncIterator[dict]:
    """Hold one capacity slot for the whole SSE stream (released at the end).

    The stream previously had no run ceiling at all, so a stalled upstream held
    one of the (default 50) in-flight slots indefinitely and a handful of stalls
    wedged the service for both streaming and non-streaming traffic. It now ends
    with a terminal ``error`` + ``done`` pair rather than a silent truncation.
    """
    from app.core.errors import ServerBusy

    acquired = False
    iterator = None
    try:
        await asyncio.wait_for(semaphore.acquire(), timeout=queue_timeout_s)
        acquired = True
    except asyncio.TimeoutError as exc:
        raise ServerBusy() from exc
    try:
        iterator = events.__aiter__()
        while True:
            try:
                event = await asyncio.wait_for(iterator.__anext__(), timeout=run_timeout_s)
            except StopAsyncIteration:
                break
            except asyncio.TimeoutError:
                yield {"event": "error", "data": '{"message": "stream timed out"}'}
                yield {"event": "done", "data": '{"ok": false}'}
                return
            yield event
    finally:
        # Close the upstream generator so the graph run is cancelled and its
        # resources released, instead of deferring to GC. `iterator` is bound
        # before the try, so a failure in `__aiter__()` cannot mask the real
        # error with an UnboundLocalError - and, worse, skip the release and
        # leak the capacity slot.
        target = iterator if iterator is not None else events
        aclose = getattr(target, "aclose", None)
        if aclose is not None:
            try:
                await aclose()
            except Exception:
                pass
        if acquired:
            semaphore.release()
