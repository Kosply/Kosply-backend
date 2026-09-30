"""UI tool tests: screen reading + safe/unknown callbacks through the graph."""

from langgraph.checkpoint.memory import InMemorySaver
from langchain_core.messages import HumanMessage

from app.agent.graph import build_graph
from tests.base_test import BaseAgentTest, StatefulFakeChatModel, canned_answer, canned_tool_call

SNAPSHOT = {"screen": "catalog", "selected": "p1", "filters": {"q": "kipas"}}


def _call(name, args, call_id="c-ui"):
    """Fake assistant turn calling one UI tool."""
    return canned_tool_call(name, args, call_id)


class ReadScreenTest(BaseAgentTest):
    """read_ui_state answers from the snapshot attached to the turn."""

    async def test_reads_snapshot(self):
        """Tool output carries the screen the model was shown."""
        fake = StatefulFakeChatModel(
            responses=[_call("read_ui_state", {"query": ""}), canned_answer("itu katalog")]
        )
        graph = build_graph(InMemorySaver(), llm=fake)
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="apa yang tampil?")],
             "user_id": "u", "ui_state": SNAPSHOT},
            {"configurable": {"thread_id": "ui-read-1"}},
        )
        tools = [m.content for m in result["messages"] if getattr(m, "type", "") == "tool"]
        self.assertTrue(any("catalog" in str(t) for t in tools))

    async def test_empty_snapshot_reported(self):
        """No snapshot attached yields the honest fallback text."""
        fake = StatefulFakeChatModel(
            responses=[_call("read_ui_state", {"query": ""}), canned_answer("ok")]
        )
        graph = build_graph(InMemorySaver(), llm=fake)
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="apa yang tampil?")], "user_id": "u"},
            {"configurable": {"thread_id": "ui-read-2"}},
        )
        tools = [m.content for m in result["messages"] if getattr(m, "type", "") == "tool"]
        self.assertTrue(any("No UI state" in str(t) for t in tools))


class CallbackToolTest(BaseAgentTest):
    """perform_callback runs safe actions immediately, refuses the rest."""

    async def test_safe_callback_runs_without_approval(self):
        """open_product executes inline (no interrupt) and returns the payload."""
        fake = StatefulFakeChatModel(
            responses=[
                _call("perform_callback",
                      {"callback": "open_product", "params": {"productId": "p1"}}),
                canned_answer("dibuka"),
            ]
        )
        graph = build_graph(InMemorySaver(), llm=fake)
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="buka produknya")], "user_id": "u"},
            {"configurable": {"thread_id": "ui-cb-1"}},
        )
        self.assertNotIn("__interrupt__", result)
        tools = [m.content for m in result["messages"] if getattr(m, "type", "") == "tool"]
        self.assertTrue(any("open_product" in str(t) for t in tools))

    async def test_unknown_callback_refused(self):
        """Risky/unknown callbacks never run; the model is told to ask instead."""
        fake = StatefulFakeChatModel(
            responses=[_call("perform_callback", {"callback": "buy_now"}),
                       canned_answer("ok")]
        )
        graph = build_graph(InMemorySaver(), llm=fake)
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="belikan")], "user_id": "u"},
            {"configurable": {"thread_id": "ui-cb-2"}},
        )
        tools = [m.content for m in result["messages"] if getattr(m, "type", "") == "tool"]
        self.assertTrue(any("Unknown callback" in str(t) for t in tools))
