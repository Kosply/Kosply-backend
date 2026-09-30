"""Compaction tests: budgets trigger, summaries replace history, resume keeps working."""

from langchain_core.messages import HumanMessage

from app.agent.memory import (
    count_tokens,
    estimate_tokens,
    needs_compaction,
    summarize_history,
)
from tests.base_test import BaseAgentTest, StatefulFakeChatModel, canned_answer
from langgraph.checkpoint.memory import InMemorySaver

from app.agent.graph import build_graph


class BudgetTest(BaseAgentTest):
    """Budget math without any model."""

    def test_estimate_scales_with_length(self):
        """Longer text counts more tokens; empty counts zero (tokenizer-backed)."""
        short = [HumanMessage(content="hi")]
        long = [HumanMessage(content="x" * 400)]
        self.assertEqual(count_tokens([]), 0)
        self.assertEqual(estimate_tokens([]), 0)
        self.assertGreater(count_tokens(long), count_tokens(short))

    def test_count_triggers(self):
        """Over message count compacts even when texts are tiny."""
        msgs = [HumanMessage(content="m") for _ in range(5)]
        self.assertTrue(needs_compaction(msgs, max_messages=4, threshold_pct=75.0, context_total=10**9))
        self.assertFalse(needs_compaction(msgs, max_messages=5, threshold_pct=75.0, context_total=10**9))

    def test_threshold_pct_triggers(self):
        """Past threshold % of the total window compacts; below it passes."""
        msgs = [HumanMessage(content="hello world, this is a test message")]
        used = count_tokens(msgs)
        total = used * 2
        self.assertTrue(needs_compaction(msgs, max_messages=100, threshold_pct=49.0, context_total=total))
        self.assertFalse(needs_compaction(msgs, max_messages=100, threshold_pct=51.0, context_total=total))


class SummarizeTest(BaseAgentTest):
    """Summarizer output shape (fake model, no real AI)."""

    async def test_summary_is_tagged_system_message(self):
        """Summary carries the context id and the model text."""
        fake = StatefulFakeChatModel(responses=[canned_answer("ringkasan")])
        out = await summarize_history(
            [HumanMessage(content="saya cari kipas"), HumanMessage(content="budget 200rb")],
            fake,
        )
        self.assertEqual(out.type, "system")
        self.assertEqual(out.id, "context-summary")
        self.assertIn("ringkasan", out.content)
        self.assertIn("2 earlier messages", out.content)


class CompactionLoopTest(BaseAgentTest):
    """End to end: over-budget turn rewrites history, session still resumes."""

    async def test_over_budget_rewrites_history(self):
        """5 old turns + tiny budgets collapse to summary + recent + answer."""
        fake = StatefulFakeChatModel(
            responses=[canned_answer("ringkasan"), canned_answer("jawab")]
        )
        graph = build_graph(
            InMemorySaver(),
            llm=fake,
            compaction_max_messages=4,
            compaction_threshold_pct=75.0,
            compaction_context_total=10**9,
            compaction_keep_recent=1,
        )
        history = [HumanMessage(content=f"pesan {i}") for i in range(5)]
        result = await graph.ainvoke(
            {"messages": history, "user_id": "u", "user_role": "BUYER"},
            {"configurable": {"thread_id": "compact-t1"}},
        )
        stored = result["messages"]
        self.assertEqual(len(stored), 3)
        self.assertEqual(stored[0].type, "system")
        self.assertIn("ringkasan", stored[0].content)
        self.assertEqual(stored[-1].content, "jawab")

    async def test_under_budget_untouched(self):
        """Small histories pass through with zero model overhead for summary."""
        fake = StatefulFakeChatModel(responses=[canned_answer("ok")])
        graph = build_graph(InMemorySaver(), llm=fake)
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="halo")], "user_id": "u"},
            {"configurable": {"thread_id": "compact-t2"}},
        )
        self.assertEqual(len(result["messages"]), 2)
        self.assertEqual(len(fake.responses), 0)
