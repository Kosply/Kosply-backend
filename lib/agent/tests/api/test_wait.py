"""Approval-wait tests: event resolve, timeout leftovers, noop fast-path."""

import asyncio
import time

from httpx import ASGITransport, AsyncClient
from langgraph.types import Command
from langchain_core.messages import HumanMessage

from app.api.shared import _wait_for_resolution
from app.main import app
from tests.base_test import BaseAgentTest, canned_answer, canned_tool_call


def _contact_call():
    """Fake sensitive tool call (pauses the graph)."""
    return canned_tool_call("request_seller_contact",
                            {"product_id": "p1", "message": "halo"})


class WaitResolutionTest(BaseAgentTest):
    """Waiter returns the moment approval lands, with leftover budget."""

    async def test_resolved_early_with_remaining(self):
        """Approval at ~1s of a 10s budget resolves with remainingS > 0."""
        graph = self.mount_fake([_contact_call(), canned_answer("done")])
        thread = "wait-t1"
        await graph.ainvoke(
            {"messages": [HumanMessage(content="hubungi")], "user_id": "u"},
            {"configurable": {"thread_id": thread}},
        )
        waiter = asyncio.create_task(_wait_for_resolution(graph, thread, 10.0))
        await asyncio.sleep(0.3)
        await graph.ainvoke(Command(resume="approve"),
                            {"configurable": {"thread_id": thread}})
        out = await asyncio.wait_for(waiter, timeout=15.0)
        self.assertEqual(out["status"], "resolved")
        self.assertGreater(out["remainingS"], 0)
        self.assertTrue(out["answer"].strip())

    async def test_timeout_reports_zero_left(self):
        """No approval within budget reports timeout with remainingS 0."""
        graph = self.mount_fake([_contact_call()])
        thread = "wait-t2"
        await graph.ainvoke(
            {"messages": [HumanMessage(content="hubungi")], "user_id": "u"},
            {"configurable": {"thread_id": thread}},
        )
        started = time.monotonic()
        out = await _wait_for_resolution(graph, thread, 1.5)
        elapsed = time.monotonic() - started
        self.assertEqual(out["status"], "timeout")
        self.assertEqual(out["remainingS"], 0)
        self.assertGreaterEqual(elapsed, 1.5)

    async def test_noop_when_nothing_pending(self):
        """Fresh threads return noop immediately (never hang)."""
        graph = self.mount_fake([canned_answer("ok")])
        started = time.monotonic()
        out = await _wait_for_resolution(graph, "wait-fresh", 10.0)
        self.assertEqual(out["status"], "noop")
        self.assertLess(time.monotonic() - started, 3.0)


class WaitRouteTest(BaseAgentTest):
    """HTTP surface: noop fast-path through the real app."""

    async def test_route_noop(self):
        """GET /ai/wait/:id on a fresh thread answers noop."""
        self.mount_fake([canned_answer("ok")])
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            res = await client.get("/ai/wait/fresh-route")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "noop")

    async def test_route_503_when_waiters_saturated(self):
        """A full waiter pool answers 503 instead of pinning more coroutines."""
        self.mount_fake([canned_answer("ok")])
        app.state.waiters = asyncio.Semaphore(0)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            res = await client.get("/ai/wait/busy-route")
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()["status"], "error")
