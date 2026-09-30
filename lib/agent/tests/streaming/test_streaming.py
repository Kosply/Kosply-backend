"""Thinking-stream tests: reasoning chunks ride a separate SSE event."""

from httpx import ASGITransport, AsyncClient
from langchain_core.messages import AIMessageChunk

from app.api.chat.streaming import split_thinking
from app.main import app
from tests.base_test import BaseAgentTest, StatefulFakeChatModel
from langchain_core.messages import AIMessage


class SplitThinkingTest(BaseAgentTest):
    """Unit: provider shapes split into (thinking, answer)."""

    def test_plain_text(self):
        """Plain text yields no thinking, all answer."""
        self.assertEqual(split_thinking(AIMessageChunk(content="halo")), ("", "halo"))

    def test_reasoning_kwarg(self):
        """OpenAI-compatible reasoning_content becomes thinking."""
        chunk = AIMessageChunk(
            content="jawab", additional_kwargs={"reasoning_content": "mikir"}
        )
        thinking, answer = split_thinking(chunk)
        self.assertEqual(thinking, "mikir")
        self.assertEqual(answer, "jawab")

    def test_content_blocks(self):
        """Thinking/text content blocks split (non_standard unwrapped)."""
        chunk = AIMessageChunk(
            content=[
                {"type": "thinking", "thinking": "mikir"},
                {"type": "text", "text": "jawab"},
            ]
        )
        self.assertEqual(split_thinking(chunk), ("mikir", "jawab"))


class ThinkingStreamTest(BaseAgentTest):
    """Integration: thinking arrives as its own SSE event, answer as token."""

    async def test_stream_emits_thinking_then_token(self):
        """End to end: thinking SSE event precedes the answer token."""
        self.reset_sse()
        fake = StatefulFakeChatModel(
            responses=[
                AIMessage(
                    content="jawabannya",
                    additional_kwargs={"reasoning_content": "mikir dulu..."},
                )
            ]
        )
        from langgraph.checkpoint.memory import InMemorySaver

        from app.agent.graph import build_graph

        self.mount_graph(build_graph(InMemorySaver(), llm=fake))
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            async with client.stream(
                "POST",
                "/ai/chat/stream",
                json={"conversation_id": "c-think-1", "user_id": "u1", "message": "halo"},
            ) as res:
                self.assertEqual(res.status_code, 200)
                body = (await res.aread()).decode()
        self.assertIn("event: thinking", body)
        self.assertIn("mikir dulu", body)
        self.assertIn("event: token", body)
