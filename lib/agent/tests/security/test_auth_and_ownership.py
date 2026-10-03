"""Security regression tests for the agent.

Every case here passed against the pre-fix build: the agent had no
authentication at all, `thread_id` came straight from the request body with no
ownership check, and the body cap trusted the `Content-Length` header.
"""

import asyncio
import types
import unittest

from httpx import ASGITransport, AsyncClient

from app.core.limits import BodyCapMiddleware, stream_guarded
from app.core.security import InternalKeyRequired, check_internal_key
from app.main import app
from tests.client import agent_headers

AUTHED_ROUTES = [
    ("post", "/ai/chat", {"conversation_id": "c1", "user_id": "u1", "message": "hi"}),
    ("post", "/ai/chat/stream", {"conversation_id": "c1", "user_id": "u1", "message": "hi"}),
    ("post", "/ai/chat/resume", {"conversation_id": "c1", "user_id": "u1", "approve": True}),
    ("get", "/ai/history/c1", None),
    ("get", "/ai/wait/c1", None),
]


def _client(headers=None):
    return AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers=headers or {}
    )


class InternalKeyTest(unittest.TestCase):
    """The shared secret is the agent's only access control."""

    def _with_key(self, key):
        """Temporarily point the guard at a specific configured key."""
        import app.core.security as security

        original = security.settings
        security.settings = types.SimpleNamespace(internal_api_key=key)
        self.addCleanup(lambda: setattr(security, "settings", original))

    def test_unset_key_fails_closed(self):
        """An unconfigured key must refuse, never mean "no key needed"."""
        self._with_key("")
        with self.assertRaises(InternalKeyRequired):
            check_internal_key("anything")

    def test_wrong_key_refused(self):
        self._with_key("secret123")
        with self.assertRaises(InternalKeyRequired):
            check_internal_key("nope")

    def test_missing_key_refused(self):
        self._with_key("secret123")
        with self.assertRaises(InternalKeyRequired):
            check_internal_key(None)

    def test_correct_key_accepted(self):
        self._with_key("secret123")
        check_internal_key("secret123")


class RoutesRequireKeyTest(unittest.IsolatedAsyncioTestCase):
    """No agent endpoint may be reachable without the server's key."""

    async def _status(self, method, path, body, headers):
        async with _client(headers) as client:
            if method == "get":
                response = await client.get(path)
            else:
                response = await client.post(path, json=body)
        return response.status_code

    async def test_routes_are_401_without_key(self):
        for method, path, body in AUTHED_ROUTES:
            with self.subTest(route=f"{method} {path}"):
                self.assertEqual(await self._status(method, path, body, {}), 401)

    async def test_routes_are_401_with_wrong_key(self):
        for method, path, body in AUTHED_ROUTES:
            with self.subTest(route=f"{method} {path}"):
                self.assertEqual(
                    await self._status(method, path, body, {"x-internal-key": "nope"}), 401
                )

    async def test_health_stays_open_for_probes(self):
        self.assertEqual(await self._status("get", "/health", None, {}), 200)

    async def test_docs_are_not_published(self):
        for path in ("/docs", "/openapi.json", "/redoc"):
            with self.subTest(path=path):
                self.assertEqual(await self._status("get", path, None, {}), 404)


class BoundedIdentifierTest(unittest.IsolatedAsyncioTestCase):
    """Unbounded ids became Postgres primary keys and URL path segments."""

    HOSTILE_BODIES = [
        {"conversation_id": "c" * 5000, "user_id": "u1", "message": "hi"},
        {"conversation_id": "c1", "user_id": "u1", "message": "m" * 50000},
        {"conversation_id": "../etc/passwd", "user_id": "u1", "message": "hi"},
        {"conversation_id": "c1", "user_id": "u1", "message": "hi", "role": "R" * 500},
        {"conversation_id": "c1", "user_id": "u1", "message": "hi", "role": "not a role"},
    ]

    async def test_hostile_input_is_rejected(self):
        for body in self.HOSTILE_BODIES:
            with self.subTest(body=body):
                self.assertEqual(
                    await self._status_post(body), 422, f"must reject {body}"
                )

    async def _status_post(self, body):
        async with _client(agent_headers()) as client:
            response = await client.post("/ai/chat", json=body)
        return response.status_code

    def test_ui_state_is_bounded(self):
        from app.api.chat.schemas import ChatRequest, UI_STATE_MAX_CHARS

        request = ChatRequest(
            conversation_id="c1",
            user_id="u1",
            message="hi",
            ui_state={"blob": "z" * (UI_STATE_MAX_CHARS + 100)},
        )
        with self.assertRaises(ValueError):
            request.check_ui_state()


class BodyCapTest(unittest.IsolatedAsyncioTestCase):
    """The cap must not depend on a header the caller controls."""

    async def test_chunked_body_without_content_length_is_capped(self):
        """A chunked upload with no Content-Length used to bypass the cap entirely."""
        from fastapi import FastAPI, Request

        inner = FastAPI()

        @inner.post("/echo")
        async def echo(request: Request):
            body = await request.body()
            return {"len": len(body)}

        capped = BodyCapMiddleware(inner, max_bytes=32)
        state = {"sent": 0}

        async def receive():
            state["sent"] += 512
            return {"type": "http.request", "body": b"x" * 512, "more_body": True}

        messages = []

        async def send(message):
            messages.append(message)

        await capped(
            {
                "type": "http",
                "method": "POST",
                "path": "/echo",
                "headers": [],  # no content-length: chunked framing
                "query_string": b"",
            },
            receive,
            send,
        )
        statuses = [m["status"] for m in messages if m["type"] == "http.response.start"]
        self.assertTrue(statuses, "a response must be produced")
        self.assertEqual(statuses[0], 413, f"expected 413, got {statuses}")
        self.assertLess(state["sent"], 4096, "must stop reading once the budget is gone")

    async def test_small_body_passes(self):
        from fastapi import FastAPI, Request

        inner = FastAPI()

        @inner.post("/echo")
        async def echo(request: Request):
            return {"len": len(await request.body())}

        capped = BodyCapMiddleware(inner, max_bytes=1024)

        async def receive():
            return {"type": "http.request", "body": b"hello", "more_body": False}

        messages = []

        async def send(message):
            messages.append(message)

        await capped(
            {
                "type": "http",
                "method": "POST",
                "path": "/echo",
                "headers": [(b"content-length", b"5")],
                "query_string": b"",
            },
            receive,
            send,
        )
        statuses = [m["status"] for m in messages if m["type"] == "http.response.start"]
        self.assertEqual(statuses[0], 200)


class _FakeCursor:
    """Minimal async cursor returning one canned row."""

    def __init__(self, row):
        self._row = row

    async def execute(self, *_args, **_kwargs):
        return None

    async def fetchone(self):
        return self._row

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False


class _FakeConn:
    def __init__(self, row):
        self._row = row

    def cursor(self):
        return _FakeCursor(self._row)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False


class _FakePool:
    """Pool stub exposing the SAME surface the production code calls.

    `AsyncConnectionPool` has no `acquire()`; the production code originally
    called it, the AttributeError was swallowed, and the ownership check never
    ran. A stub with only `connection()` reproduces that trap, so this test
    fails if the wrong method is used again.
    """

    def __init__(self, row, raise_on_use=None):
        self._row = row
        self._raise = raise_on_use
        self.calls = 0

    def connection(self):
        self.calls += 1
        if self._raise is not None:
            raise self._raise
        return _FakeConn(self._row)

    async def aclose(self):
        return None


class ThreadOwnershipTest(unittest.IsolatedAsyncioTestCase):
    """`thread_id` is the request body's conversation_id: the IDOR fix."""

    def _set_pool(self, pool):
        app.state.db = pool
        self.addCleanup(lambda: setattr(app.state, "db", None))

    async def _chat(self, body):
        async with _client(agent_headers()) as client:
            return await client.post("/ai/chat", json=body)

    async def test_another_users_thread_is_refused(self):
        """A caller must not be able to write into (or read) a foreign thread."""
        self._set_pool(_FakePool(("victim-user",)))
        for path, body in (
            ("/ai/chat", {"conversation_id": "victim", "user_id": "attacker", "message": "hi"}),
            ("/ai/chat/resume", {"conversation_id": "victim", "user_id": "attacker", "approve": True}),
        ):
            with self.subTest(route=path):
                async with _client(agent_headers()) as client:
                    response = await client.post(path, json=body)
                self.assertEqual(response.status_code, 404, f"{path} must refuse a foreign thread")

    async def test_history_of_a_foreign_thread_is_refused(self):
        self._set_pool(_FakePool(("victim-user",)))
        async with _client(agent_headers()) as client:
            response = await client.get("/ai/history/victim?user_id=attacker")
        self.assertEqual(response.status_code, 404)

    async def test_the_owners_own_thread_is_allowed(self):
        """Ownership must not become a blanket block: the real owner proceeds."""
        from app.api.shared import assert_thread_ownership

        self._set_pool(_FakePool(("me",)))
        # No exception is the assertion.
        await assert_thread_ownership(app, "mine", "me")

    async def test_an_unknown_thread_is_allowed(self):
        """A first turn creates the thread, so there is nothing to own yet."""
        from app.api.shared import assert_thread_ownership

        self._set_pool(_FakePool(None))
        await assert_thread_ownership(app, "brand-new", "me")

    async def test_a_failing_pool_fails_closed(self):
        """An exhausted pool must not silently skip the check (that is a bypass)."""
        self._set_pool(_FakePool(None, raise_on_use=RuntimeError("pool exhausted")))
        async with _client(agent_headers()) as client:
            response = await client.get("/ai/history/x?user_id=me")
        self.assertEqual(
            response.status_code, 503, "a broken ownership check must refuse, not allow"
        )

    async def test_the_pool_method_actually_exists(self):
        """Guards the regression directly: `acquire()` does not exist on the pool."""
        from psycopg_pool import AsyncConnectionPool

        self.assertTrue(hasattr(AsyncConnectionPool, "connection"))
        self.assertFalse(
            hasattr(AsyncConnectionPool, "acquire"),
            "if this ever becomes true the stub in this file is no longer faithful",
        )


class MiddlewareOrderTest(unittest.IsolatedAsyncioTestCase):
    """The body cap must be OUTERMOST, or the rate limiter buffers the upload.

    The rate limiter calls `await request.body()`. If it sits outside the cap it
    reads an entire 8 MB chunked upload into memory before the 1 MB cap ever
    sees a byte, which is the amplification the cap exists to prevent. The
    ordering was previously inverted and this test measures it.
    """

    async def test_rate_limiter_never_buffers_an_oversized_chunked_body(self):
        """A 8 MiB chunked upload must never reach the rate limiter's reader.

        Built as a local app rather than by reloading `app.main`, which would
        mutate module state shared with every other test.
        """
        from fastapi import FastAPI

        from app.core.limits import RateLimiter
        from app.core.limits.ratelimit import rate_limit_middleware

        seen = {}

        def spy(limiter):
            middleware = rate_limit_middleware(limiter)

            async def wrapped(request, call_next):
                seen["entered"] = True
                seen["buffered"] = len(await request.body())
                return await middleware(request, call_next)

            return wrapped

        # Mirrors the registration order in app/main.py. `add_middleware` and
        # the `middleware("http")` decorator both INSERT AT INDEX 0, so the one
        # added LAST is OUTERMOST: the body cap is registered last, putting it
        # in front of the rate limiter.
        api = FastAPI()

        @api.post("/ai/chat")
        async def chat():
            return {"ok": True}

        api.middleware("http")(spy(RateLimiter(1000)))
        api.add_middleware(BodyCapMiddleware, max_bytes=1000)

        async def chunks():
            for _ in range(16):
                yield b"x" * 524288  # 8 MiB total

        async with AsyncClient(
            transport=ASGITransport(app=api), base_url="http://t"
        ) as client:
            response = await client.post("/ai/chat", content=chunks())

        self.assertEqual(response.status_code, 413)
        # The limiter may be *entered* (it sits behind the cap), but it must
        # never have buffered the oversized body: by then the cap has already
        # cut the stream, so its read raises instead of accumulating 8 MB.
        self.assertLess(
            seen.get("buffered") or 0,
            1000,
            f"the rate limiter buffered {seen.get('buffered')} bytes, defeating the cap",
        )

    async def test_no_double_response_after_substitution(self):
        """Sending our 413 must not also forward the app's own error body."""
        from fastapi import FastAPI, Request

        inner = FastAPI()

        @inner.post("/echo")
        async def echo(request: Request):
            return {"len": len(await request.body())}

        capped = BodyCapMiddleware(inner, max_bytes=32)
        sent = []

        async def receive():
            return {"type": "http.request", "body": b"x" * 4096, "more_body": True}

        async def send(message):
            sent.append(message)

        await capped(
            {"type": "http", "method": "POST", "path": "/echo", "headers": [],
             "query_string": b""},
            receive,
            send,
        )
        starts = [m for m in sent if m["type"] == "http.response.start"]
        bodies = [m for m in sent if m["type"] == "http.response.body"]
        self.assertEqual(len(starts), 1, f"exactly one response start, got {len(starts)}")
        self.assertEqual(starts[0]["status"], 413)
        self.assertEqual(len(bodies), 1, f"exactly one body frame, got {len(bodies)}")


class StreamGuardTest(unittest.IsolatedAsyncioTestCase):
    """A stalled stream must not hold a capacity slot forever."""

    async def test_stalled_stream_ends_with_a_terminal_event(self):
        """Previously there was no run ceiling, so a stall pinned a slot."""

        async def never_yields():
            await asyncio.sleep(3600)
            yield {"event": "token", "data": "{}"}  # pragma: no cover

        semaphore = asyncio.Semaphore(1)
        events = [
            event
            async for event in stream_guarded(
                semaphore, never_yields(), queue_timeout_s=0.1, run_timeout_s=0.05
            )
        ]
        kinds = [e["event"] for e in events]
        self.assertIn("error", kinds, f"expected a terminal error, got {kinds}")
        self.assertEqual(kinds[-1], "done", "must end with a terminal event")
        self.assertEqual(semaphore._value, 1, "the capacity slot must be released")

    async def test_saturated_semaphore_still_raises(self):
        from app.core.errors import ServerBusy

        async def gen():
            yield {"event": "token", "data": "{}"}  # pragma: no cover

        semaphore = asyncio.Semaphore(0)
        with self.assertRaises(ServerBusy):
            async for _ in stream_guarded(semaphore, gen(), queue_timeout_s=0.05):
                pass


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
