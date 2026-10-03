"""UI route tests: callbacks ride the turn response + SSE stream."""

from httpx import ASGITransport, AsyncClient

from tests.client import agent_headers
from app.main import app
from tests.base_test import BaseAgentTest, StatefulFakeChatModel, canned_answer, canned_tool_call


class UiRouteTest(BaseAgentTest):
    """Chat responses carry callbacks; streams emit callback events."""

    async def test_chat_response_carries_callbacks(self):
        """Approved-safe callback lands in ChatResponse.callbacks for Flutter."""
        self.mount_fake([
            canned_tool_call("perform_callback",
                             {"callback": "open_product", "params": {"productId": "p1"}}),
            canned_answer("dibuka ya"),
        ])
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test",
            headers=agent_headers(),
        ) as client:
            res = await client.post(
                "/ai/chat",
                json={"conversation_id": "c-ui-1", "user_id": "u1",
                      "message": "buka produknya",
                      "ui_state": {"screen": "catalog"}},
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            res.json()["callbacks"],
            [{"callback": "open_product", "args": {"productId": "p1"}}],
        )

    async def test_stream_emits_callback_event(self):
        """SSE stream yields a callback event Flutter executes live."""
        self.reset_sse()
        self.mount_fake([
            canned_tool_call("perform_callback",
                             {"callback": "apply_filter", "params": {"q": "kipas"}}),
            canned_answer("difilter ya"),
        ])
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test",
            headers=agent_headers(),
        ) as client:
            async with client.stream(
                "POST",
                "/ai/chat/stream",
                json={"conversation_id": "c-ui-2", "user_id": "u1",
                      "message": "filter kipas"},
            ) as res:
                self.assertEqual(res.status_code, 200)
                body = (await res.aread()).decode()
        self.assertIn("event: callback", body)
        self.assertIn("apply_filter", body)
