"""Loop runner tests: outcomes, bad steps, thread isolation."""

from tests.base_test import BaseAgentTest, canned_answer


class LoopRunnerTest(BaseAgentTest):
    """`BaseAgentTest.loop()` replays steps on one thread deterministically."""

    async def test_unknown_step_raises(self):
        """Unknown step kinds fail fast with ValueError (before any graph call)."""
        graph = self.make_graph([])
        with self.assertRaises(ValueError):
            await self.loop(graph, [("bogus", "x")])

    async def test_threads_are_isolated(self):
        """Same steps on two threads keep separate histories."""
        graph = self.make_graph([canned_answer("satu"), canned_answer("dua")])
        out_a = await self.loop(graph, [("send", "halo")], thread="t-a")
        out_b = await self.loop(graph, [("send", "halo")], thread="t-b")
        self.assertEqual(out_a[0]["answer"], "satu")
        self.assertEqual(out_b[0]["answer"], "dua")
        state_a = await graph.aget_state(self._config("t-a"))
        state_b = await graph.aget_state(self._config("t-b"))
        self.assertEqual(len(state_a.values["messages"]), 2)
        self.assertEqual(len(state_b.values["messages"]), 2)
