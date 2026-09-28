"""Graph loop tests: plain answer, interrupt/approve/reject, memory across turns."""

from tests.base_test import BaseAgentTest, canned_answer, canned_tool_call

CONTACT_CALL = canned_tool_call(
    "request_seller_contact",
    {"product_id": "p1", "message": "halo, masih ada?"},
)


class PlainAnswerTest(BaseAgentTest):
    """One turn, no tools: answer comes straight back."""

    async def test_plain_answer(self):
        """A tool-free turn answers directly from the canned reply."""
        graph = self.make_graph([canned_answer("hai, ada yang bisa dibantu?")])
        [out] = await self.loop(graph, [("send", "halo")])
        self.assertEqual(out["answer"], "hai, ada yang bisa dibantu?")


class ApprovalFlowTest(BaseAgentTest):
    """Sensitive tool pauses the graph; approve runs it, reject cancels it."""

    async def test_interrupt_then_approve(self):
        """Approval pauses with the tool name, resume runs it to completion."""
        graph = self.make_graph([CONTACT_CALL, canned_answer("contact sent")])
        outs = await self.loop(graph, [("send", "hubungi seller"), ("approve", True)])
        self.assertIn("needs_approval", outs[0])
        pending = outs[0]["needs_approval"][0]["pending_tools"]
        self.assertEqual(pending[0]["name"], "request_seller_contact")
        self.assertEqual(outs[1]["answer"], "contact sent")

    async def test_interrupt_then_reject(self):
        """Rejection cancels the tool: it never runs, the agent explains instead."""
        graph = self.make_graph([CONTACT_CALL, canned_answer("Baik, dibatalkan.")])
        outs = await self.loop(graph, [("send", "hubungi seller"), ("approve", False)])
        self.assertIn("needs_approval", outs[0])
        self.assertEqual(outs[1]["answer"], "Baik, dibatalkan.")
        state = await graph.aget_state(self._config())
        contents = [str(m.content) for m in state.values.get("messages", [])]
        self.assertFalse(any("Contact request queued" in c for c in contents))


class MemoryLoopTest(BaseAgentTest):
    """Two turns on one thread: history persists (resume works)."""

    async def test_memory_across_turns(self):
        """Two sends on one thread share history (resume keeps working)."""
        graph = self.make_graph([canned_answer("hai"), canned_answer("sama-sama")])
        outs = await self.loop(graph, [("send", "halo"), ("send", "makasih")])
        self.assertEqual(outs[0]["answer"], "hai")
        self.assertEqual(outs[1]["answer"], "sama-sama")
        state = await graph.aget_state(self._config())
        self.assertGreaterEqual(len(state.values.get("messages", [])), 4)
