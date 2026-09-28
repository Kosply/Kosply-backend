"""Rate limit tests: window math plus middleware behavior."""

import time

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.ratelimit import RateLimiter, rate_limit_middleware
from tests.base_test import BaseAgentTest


class LimiterUnitTest(BaseAgentTest):
    """Sliding-window counter without any HTTP."""

    def test_allows_up_to_budget(self):
        """First N hits pass, N+1 is refused."""
        limiter = RateLimiter(2, window_seconds=60.0)
        self.assertTrue(limiter.allowed("k"))
        self.assertTrue(limiter.allowed("k"))
        self.assertFalse(limiter.allowed("k"))

    def test_keys_are_independent(self):
        """One spent key never blocks another."""
        limiter = RateLimiter(1, window_seconds=60.0)
        self.assertTrue(limiter.allowed("a"))
        self.assertFalse(limiter.allowed("a"))
        self.assertTrue(limiter.allowed("b"))

    def test_window_slides(self):
        """Hits older than the window stop counting."""
        limiter = RateLimiter(1, window_seconds=60.0)
        self.assertTrue(limiter.allowed("k"))
        limiter._hits["k"][0] -= 61.0
        self.assertTrue(limiter.allowed("k"))


def _mini_app(limit: int):
    """Tiny app with only the rate middleware (isolated from the agent)."""
    mini = FastAPI()
    mini.middleware("http")(rate_limit_middleware(RateLimiter(limit)))

    @mini.post("/ai/x")
    async def guarded():
        """Always-ok guarded endpoint."""
        return {"ok": True}

    @mini.get("/other")
    async def open():
        """Unguarded endpoint outside /ai/*."""
        return {"ok": True}

    return mini


class MiddlewareTest(BaseAgentTest):
    """Middleware keys by user_id, falls back to IP, skips non-/ai paths."""

    async def test_blocks_over_budget(self):
        """Third hit in the window answers 429 with a stable code."""
        transport = ASGITransport(app=_mini_app(2))
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            for _ in range(2):
                res = await client.post("/ai/x", json={"user_id": "u1"})
                self.assertEqual(res.status_code, 200)
            res = await client.post("/ai/x", json={"user_id": "u1"})
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.json()["code"], "RATE_LIMITED")

    async def test_users_are_independent(self):
        """Spent budget of user A never blocks user B."""
        transport = ASGITransport(app=_mini_app(1))
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            self.assertEqual((await client.post("/ai/x", json={"user_id": "a"})).status_code, 200)
            self.assertEqual((await client.post("/ai/x", json={"user_id": "a"})).status_code, 429)
            self.assertEqual((await client.post("/ai/x", json={"user_id": "b"})).status_code, 200)

    async def test_non_ai_paths_untouched(self):
        """Paths outside /ai/* never consume budget."""
        transport = ASGITransport(app=_mini_app(1))
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            for _ in range(3):
                res = await client.get("/other")
                self.assertEqual(res.status_code, 200)
