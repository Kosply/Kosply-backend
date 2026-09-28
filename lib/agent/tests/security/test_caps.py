"""Capacity tests: body cap, bounded runs, stream slots."""

import asyncio

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.caps import body_cap_middleware, run_guarded, stream_guarded
from app.core.errors import ModelTimeout, ServerBusy
from tests.base_test import BaseAgentTest


class BodyCapTest(BaseAgentTest):
    """Oversized bodies are rejected before parsing."""

    def _mini_app(self):
        mini = FastAPI()
        mini.middleware("http")(body_cap_middleware(10))

        @mini.post("/ai/x")
        async def guarded():
            """Always-ok guarded endpoint."""
            return {"ok": True}

        return mini

    async def test_big_body_rejected(self):
        """Content-Length over budget answers 413 with a stable code."""
        transport = ASGITransport(app=self._mini_app())
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post("/ai/x", content=b"x" * 11)
        self.assertEqual(res.status_code, 413)
        self.assertEqual(res.json()["code"], "BODY_TOO_LARGE")

    async def test_small_body_passes(self):
        """Bodies within budget flow through."""
        transport = ASGITransport(app=self._mini_app())
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post("/ai/x", content=b"hi")
        self.assertEqual(res.status_code, 200)


class BoundedRunTest(BaseAgentTest):
    """run_guarded caps queue wait and run time."""

    async def test_success_passthrough(self):
        """Fast operations return their value and free the slot."""

        async def op():
            """Trivial operation."""
            return "done"

        sem = asyncio.Semaphore(1)
        out = await run_guarded(sem, op, queue_timeout_s=1.0, run_timeout_s=1.0)
        self.assertEqual(out, "done")
        self.assertEqual(sem._value, 1)

    async def test_busy_when_full(self):
        """No free slot in time answers ServerBusy (HTTP 503 downstream)."""
        sem = asyncio.Semaphore(1)
        await sem.acquire()

        async def op():
            """Never runs: no slot frees up."""
            return "never"

        try:
            with self.assertRaises(ServerBusy):
                await run_guarded(sem, op, queue_timeout_s=0.01, run_timeout_s=1.0)
        finally:
            sem.release()

    async def test_timeout_when_slow(self):
        """Slow runs abort as ModelTimeout (HTTP 504 downstream)."""

        async def op():
            """Deliberately slow operation."""
            await asyncio.sleep(0.2)
            return "late"

        with self.assertRaises(ModelTimeout):
            await run_guarded(
                asyncio.Semaphore(1), op, queue_timeout_s=1.0, run_timeout_s=0.01
            )


class BoundedStreamTest(BaseAgentTest):
    """stream_guarded holds one slot for the whole SSE stream."""

    async def test_events_flow_and_slot_frees(self):
        """Events pass through; the slot returns afterwards."""

        async def events():
            """Two canned SSE events."""
            yield {"event": "token", "data": "{}"}
            yield {"event": "done", "data": "{}"}

        sem = asyncio.Semaphore(1)
        seen = [e async for e in stream_guarded(sem, events(), queue_timeout_s=1.0)]
        self.assertEqual(len(seen), 2)
        self.assertEqual(sem._value, 1)

    async def test_busy_stream_raises(self):
        """A held slot makes new streams fail fast with ServerBusy."""

        async def events():
            """Never consumed: no slot frees up."""
            yield {"event": "token", "data": "{}"}

        sem = asyncio.Semaphore(1)
        await sem.acquire()
        try:
            with self.assertRaises(ServerBusy):
                async for _ in stream_guarded(sem, events(), queue_timeout_s=0.01):
                    pass
        finally:
            sem.release()
