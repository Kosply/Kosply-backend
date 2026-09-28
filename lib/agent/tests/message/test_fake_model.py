"""Fake model tests: order, input log, tool binding, empty fallback."""

from langchain_core.messages import HumanMessage

from tests.base_test import BaseAgentTest, StatefulFakeChatModel, canned_answer


class FakeOrderTest(BaseAgentTest):
    """Canned replies come out in order (stateful, no real AI)."""

    def test_consumes_in_order(self):
        """Pop order matches the given list."""
        fake = StatefulFakeChatModel(
            responses=[canned_answer("satu"), canned_answer("dua")]
        )
        self.assertEqual(fake.invoke([HumanMessage(content="a")]).content, "satu")
        self.assertEqual(fake.invoke([HumanMessage(content="b")]).content, "dua")

    def test_empty_fallback(self):
        """No canned replies left yields the 'empty' fallback."""
        fake = StatefulFakeChatModel(responses=[])
        self.assertEqual(fake.invoke([HumanMessage(content="a")]).content, "empty")

    def test_records_inputs(self):
        """Every call logs its received messages (wiring assertions use this)."""
        fake = StatefulFakeChatModel(responses=[canned_answer("ok")])
        fake.invoke([HumanMessage(content="halo")])
        self.assertEqual(len(fake.seen_inputs), 1)
        self.assertEqual(fake.seen_inputs[0][0].content, "halo")

    def test_bind_tools_returns_self(self):
        """Tool binding is accepted and returns the same fake."""
        fake = StatefulFakeChatModel(responses=[])
        self.assertIs(fake.bind_tools(["whatever"]), fake)
