"""Human-in-the-loop: approval must not become an impersonation vector.

The gate itself is already covered by `tests/graph/test_graph.py` (interrupt,
approve, reject). What was NOT covered is the property that makes it safe: the
identity used by an APPROVED tool comes from the session, never from the model.

`send_chat_message` and `request_seller_contact` take the acting user from graph
state via `InjectedState`. If that were ever sourced from the model's tool
arguments, "send this message" would silently become "send this message AS
anyone" -- which is precisely the attack approval exists to prevent. So: pin the
session user, and pin the refusal when there is no session at all.
"""

import unittest
from unittest import mock

from langgraph.types import Command

from app.agent.tools import SENSITIVE_TOOLS
from tests.base_test import BaseAgentTest, canned_answer, canned_tool_call


class _Resp:
    status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        return {"status": "ok"}


SEND_CALL = canned_tool_call("send_chat_message", {"conversation_id": "c1", "text": "halo"})
CONTACT_CALL = canned_tool_call(
    "request_seller_contact", {"product_id": "p1", "message": "masih ada?"}
)


class ApprovalIdentityTest(BaseAgentTest):
    """An approved action acts as the session user, never as the model."""

    THREAD_ID = "t-approve-identity"

    def test_write_tools_are_all_gated(self):
        # Anything that changes state on the server must be behind approval, or
        # the gate is decorative.
        self.assertEqual(SENSITIVE_TOOLS, {"request_seller_contact", "send_chat_message"})

    async def test_approved_send_acts_as_the_session_user(self):
        graph = self.make_graph([SEND_CALL, canned_answer("terkirim")])
        with mock.patch("app.agent.tools.chat.chat.server_post", return_value=_Resp()) as post:
            outs = await self.loop(graph, [("send", "kirim"), ("approve", True)])
        self.assertIn("needs_approval", outs[0], "a sensitive tool must pause for approval")
        pending = outs[0]["needs_approval"][0]["pending_tools"]
        self.assertEqual(pending[0]["name"], "send_chat_message")
        self.assertTrue(post.called, "an approved tool must actually run")
        # `BaseAgentTest.loop` sets user_id to "u-test".
        self.assertEqual(post.call_args.kwargs["json"]["senderId"], "u-test")

    async def test_model_cannot_choose_the_acting_user(self):
        """A model-supplied senderId/user_id is ignored."""
        graph = self.make_graph([
            canned_tool_call(
                "send_chat_message",
                {
                    "conversation_id": "c1",
                    "text": "halo",
                    "senderId": "u-victim",
                    "user_id": "u-victim",
                },
            ),
            canned_answer("terkirim"),
        ])
        with mock.patch("app.agent.tools.chat.chat.server_post", return_value=_Resp()) as post:
            await self.loop(graph, [("send", "kirim"), ("approve", True)])
        self.assertTrue(post.called)
        self.assertEqual(
            post.call_args.kwargs["json"]["senderId"],
            "u-test",
            "the acting user must come from the session, not the tool arguments",
        )

    async def test_rejected_action_never_touches_the_network(self):
        graph = self.make_graph([SEND_CALL, canned_answer("dibatalkan")])
        with mock.patch("app.agent.tools.chat.chat.server_post", return_value=_Resp()) as post:
            outs = await self.loop(graph, [("send", "kirim"), ("approve", False)])
        self.assertFalse(post.called, "a rejected action must not run")
        state = await graph.aget_state(self._config())
        contents = [str(m.content) for m in state.values.get("messages", [])]
        self.assertFalse(any("rejected" in c.lower() for c in contents if "rejected" not in c.lower()))

    async def test_contact_request_also_acts_as_the_session_user(self):
        graph = self.make_graph([CONTACT_CALL, canned_answer("diproses")])
        with mock.patch("app.agent.tools.contact.contact.server_post", return_value=_Resp()) as post:
            await self.loop(graph, [("send", "hubungi penjual"), ("approve", True)])
        self.assertTrue(post.called)
        self.assertEqual(post.call_args.kwargs["json"]["buyerId"], "u-test")

    async def test_read_only_tool_does_not_interrupt(self):
        """Browsing must not pause, or the agent is unusable for search."""
        graph = self.make_graph([
            canned_tool_call("search_catalog", {"query": "laptop"}),
            canned_answer("ada 3 barang"),
        ])
        with mock.patch(
            "app.agent.tools.catalog.catalog.server_get", return_value=_Resp()
        ):
            outs = await self.loop(graph, [("send", "cari laptop")])
        self.assertNotIn("needs_approval", outs[0])
        self.assertEqual(outs[0]["answer"], "ada 3 barang")


class NoSessionNoSendTest(BaseAgentTest):
    """With no user in state, an approved action still must not send."""

    THREAD_ID = "t-nosession"

    async def test_approved_send_without_a_session_sends_nothing(self):
        from langchain_core.messages import HumanMessage

        graph = self.make_graph([SEND_CALL, canned_answer("terkirim")])
        config = self._config()
        # Deliberately no `user_id` in the initial state.
        await graph.ainvoke({"messages": [HumanMessage(content="kirim")]}, config)
        with mock.patch("app.agent.tools.chat.chat.server_post", return_value=_Resp()) as post:
            out = await graph.ainvoke(Command(resume="approve"), config)
        self.assertFalse(post.called, "must not send without a session user")
        contents = [str(m.content) for m in out.get("messages", [])]
        self.assertTrue(any("No user in session" in c for c in contents), contents)


if __name__ == "__main__":
    unittest.main()