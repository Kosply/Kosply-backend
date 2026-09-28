"""Canned message shape tests: helpers build exactly what the graph expects."""

from tests.base_test import BaseAgentTest, canned_answer, canned_tool_call


class CannedShapeTest(BaseAgentTest):
    """Helper output shapes (content, type, tool-call structure)."""

    def test_answer_shape(self):
        """Plain helper is an ai message with content and no tool calls."""
        msg = canned_answer("hai")
        self.assertEqual(msg.type, "ai")
        self.assertEqual(msg.content, "hai")
        self.assertFalse(msg.tool_calls)

    def test_tool_call_shape(self):
        """Tool helper carries name/args/id in LangGraph's tool-call format."""
        msg = canned_tool_call("op_nama", {"kunci": "nilai"}, "c9")
        [call] = msg.tool_calls
        self.assertEqual(call["name"], "op_nama")
        self.assertEqual(call["args"], {"kunci": "nilai"})
        self.assertEqual(call["id"], "c9")
