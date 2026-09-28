"""API tests via httpx ASGI transport (no TestClient portal, no real AI)."""

from httpx import ASGITransport, AsyncClient

from app.main import app

from tests.base_test import BaseAgentTest, canned_answer, canned_tool_call


class ApiTest(BaseAgentTest):
    """HTTP layer: health, chat approval flow, SSE stream, history."""

    def _transport(self):
        """ASGI transport against the real app (no TestClient portal)."""
        return ASGITransport(app=app)

    async def test_health(self):
        """Liveness probe returns the service name."""
        async with AsyncClient(
            transport=self._transport(), base_url="http://test"
        ) as client:
            res = await client.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["service"], "kosply-agent")

    async def test_chat_approval_then_resume(self):
        """HTTP approval flow: 409 names the tool, resume completes the turn."""
        app.state.graph = self.make_graph(
            [
                canned_tool_call(
                    "request_seller_contact",
                    {"product_id": "p1", "message": "halo"},
                ),
                canned_answer("contact sent"),
            ]
        )
        async with AsyncClient(
            transport=self._transport(), base_url="http://test"
        ) as client:
            res = await client.post(
                "/ai/chat",
                json={"conversation_id": "c-api-1", "user_id": "u1", "message": "hubungi seller"},
            )
            self.assertEqual(res.status_code, 409)
            self.assertEqual(res.json()["status"], "needs_approval")

            res = await client.post(
                "/ai/chat/resume",
                json={"conversation_id": "c-api-1", "user_id": "u1", "approve": True},
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["answer"], "contact sent")

    async def test_chat_stream(self):
        """SSE stream ends with a done event."""
        self.reset_sse()
        app.state.graph = self.make_graph([canned_answer("halo juga")])
        async with AsyncClient(
            transport=self._transport(), base_url="http://test"
        ) as client:
            async with client.stream(
                "POST",
                "/ai/chat/stream",
                json={"conversation_id": "c-api-2", "user_id": "u1", "message": "halo"},
            ) as res:
                self.assertEqual(res.status_code, 200)
                body = await res.aread()
        self.assertIn("done", body.decode())

    async def test_history(self):
        """History lists both sides of the finished turn."""
        app.state.graph = self.make_graph([canned_answer("hai")])
        async with AsyncClient(
            transport=self._transport(), base_url="http://test"
        ) as client:
            await client.post(
                "/ai/chat",
                json={"conversation_id": "c-api-3", "user_id": "u1", "message": "halo"},
            )
            res = await client.get("/ai/history/c-api-3")
        self.assertEqual(res.status_code, 200)
        roles = [m["role"] for m in res.json()["messages"]]
        self.assertIn("human", roles)
        self.assertIn("ai", roles)
