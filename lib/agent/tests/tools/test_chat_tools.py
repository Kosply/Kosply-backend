"""Nego tool tests: read history + approved send (mocked HTTP)."""

from unittest import mock

from langgraph.checkpoint.memory import InMemorySaver
from langchain_core.messages import HumanMessage

from app.agent.graph import build_graph
from app.agent.tools import read_conversation, send_chat_message
from app.core.errors import ToolError
from tests.base_test import BaseAgentTest, StatefulFakeChatModel, canned_answer, canned_tool_call


class FakeResp:
    """Minimal httpx response double."""

    def __init__(self, payload, status=200):
        """Store payload and status."""
        self._payload = payload
        self._status = status

    def raise_for_status(self):
        """Fail on 4xx/5xx like httpx does."""
        if self._status >= 400:
            raise RuntimeError(f"HTTP {self._status}")

    def json(self):
        """Return the canned payload."""
        return self._payload


class NegoToolTest(BaseAgentTest):
    """read_conversation passes history through; send posts as the state user."""

    def test_read_returns_history(self):
        """History payload reaches the model untouched."""
        with mock.patch(
            "app.agent.tools.chat.chat.server_get",
            return_value=FakeResp({"status": "ok", "items": [{"text": "nego 100rb?"}]}),
        ):
            # `user_id` from graph state is required: the server's membership
            # gate needs `userId`, so without it the call was a 400.
            out = read_conversation.invoke(
                {"conversation_id": "c1", "state": {"user_id": "u-1"}}
            )
        self.assertIn("nego 100rb?", out)

    def test_read_refuses_without_a_session_user(self):
        """No session user must never reach the network."""
        with mock.patch("app.agent.tools.chat.chat.server_get") as call:
            out = read_conversation.invoke({"conversation_id": "c1", "state": {}})
        self.assertIn("No user in session", out)
        call.assert_not_called()

    def test_read_failure_is_tool_error(self):
        """Transport failures surface as ToolError."""
        with mock.patch(
            "app.agent.tools.chat.chat.server_get", side_effect=ConnectionError("down")
        ):
            with self.assertRaises(ToolError):
                read_conversation.invoke(
                    {"conversation_id": "c1", "state": {"user_id": "u-1"}}
                )

    def test_send_guards_empty_and_userless(self):
        """Empty text and missing users never hit the network."""
        with mock.patch(
            "app.agent.tools.chat.chat.server_post",
            side_effect=AssertionError("must not call"),
        ):
            out = send_chat_message.invoke(
                {"conversation_id": "c1", "text": "  ",
                 "state": {"user_id": "u1"}}
            )
            self.assertIn("Empty message", out)

    def test_send_posts_as_state_user(self):
        """Approved sends POST senderId from graph state (never invented)."""
        seen = {}

        def fake_post(url, **kwargs):
            """Capture the outgoing payload."""
            seen.update(kwargs.get("json", {}))
            return FakeResp({"status": "ok", "item": {"id": "m1"}})

        with mock.patch("app.agent.tools.chat.chat.server_post", side_effect=fake_post):
            out = send_chat_message.invoke(
                {"conversation_id": "c1", "text": "deal 100rb",
                 "state": {"user_id": "u9"}}
            )
        self.assertEqual(seen.get("senderId"), "u9")
        self.assertIn("ok", out)


class NegoApprovalTest(BaseAgentTest):
    """send_chat_message pauses for approval like any sensitive tool."""

    async def test_send_needs_approval(self):
        """Interrupt names the tool; the payload is untouched."""
        fake = StatefulFakeChatModel(
            responses=[
                canned_tool_call("send_chat_message",
                                 {"conversation_id": "c1", "text": "deal?"}),
                canned_answer("dikirim"),
            ]
        )
        graph = build_graph(InMemorySaver(), llm=fake)
        outs = await self.loop(graph, [("send", "tawarkan deal"), ("approve", True)])
        self.assertIn("needs_approval", outs[0])
        self.assertEqual(
            outs[0]["needs_approval"][0]["pending_tools"][0]["name"],
            "send_chat_message",
        )
