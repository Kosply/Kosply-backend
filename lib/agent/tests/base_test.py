"""Base test kit: stateful fake LLM (no real AI) + loop runner.

`StatefulFakeChatModel` pops canned `AIMessage`s in order, so multi-turn
scenarios are deterministic. `BaseAgentTest.loop()` feeds steps to ONE
compiled graph on ONE thread_id — that is the "loop test": it exercises
memory + resume across turns, not just single shots.

Step shapes:
- `("send", text)` ......... one user turn -> `{"answer": str}` or `{"needs_approval": [...]}`.
- `("approve", True/False)`  resume a pending interrupt -> same outcome shape.
"""

import os
import unittest

# Dummy key for every test module (import order independent): the lifespan
# constructs the lazy real model at boot but never calls it.
os.environ.setdefault("OPENAI_API_KEY", "test-dummy-key")

from pydantic import Field

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from app.agent.graph import build_graph


def canned_answer(text: str) -> AIMessage:
    """Fake assistant reply (no tool call)."""
    return AIMessage(content=text)


def canned_tool_call(name: str, args: dict, call_id: str = "call-1") -> AIMessage:
    """Fake assistant turn that calls one tool."""
    return AIMessage(
        content="",
        tool_calls=[{"name": name, "args": args, "id": call_id, "type": "tool_call"}],
    )


class StatefulFakeChatModel(BaseChatModel):
    """Stateful fake: pops canned responses in order (no network, no key)."""

    responses: list
    seen_inputs: list = Field(default_factory=list)

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        """Pop the next canned reply and record the received input."""
        self.seen_inputs.append(list(messages))
        msg = self.responses.pop(0) if self.responses else AIMessage(content="empty")
        return ChatResult(generations=[ChatGeneration(message=msg)])

    @property
    def _llm_type(self) -> str:
        """Fake model identifier (appears in traces)."""
        return "stateful-fake"

    def bind_tools(self, tools, **kwargs):
        """Accept tool binding and return self (tools are faked too)."""
        return self


class BaseAgentTest(unittest.IsolatedAsyncioTestCase):
    """Base class: graph factory + loop runner. Subclasses fill RESPONSES."""

    RESPONSES: list = []
    THREAD_ID = "test-thread"

    @staticmethod
    def reset_sse():
        """Drop sse-starlette's global exit event (it binds to the first loop).

        Each test here runs on a fresh event loop; without reset, the second
        SSE test reuses an Event from a closed loop and crashes.
        """
        from sse_starlette.sse import AppStatus

        AppStatus.should_exit_event = None

    def make_graph(self, responses=None):
        """Compile a fresh graph on InMemorySaver with the stateful fake."""
        fake = StatefulFakeChatModel(
            responses=list(responses if responses is not None else self.RESPONSES)
        )
        return build_graph(InMemorySaver(), llm=fake)

    def _config(self, thread=None) -> dict:
        """LangGraph config pointing at one resume thread."""
        return {"configurable": {"thread_id": thread or self.THREAD_ID}}

    async def loop(self, graph, steps, thread=None, role="UNKNOWN") -> list:
        """Run loop steps on one thread. Returns one outcome per step."""
        outcomes = []
        config = self._config(thread)
        for kind, payload in steps:
            if kind == "send":
                result = await graph.ainvoke(
                    {
                        "messages": [HumanMessage(content=payload)],
                        "user_id": "u-test",
                        "user_role": role,
                    },
                    config,
                )
            elif kind == "approve":
                result = await graph.ainvoke(
                    Command(resume="approve" if payload else "reject"), config
                )
            else:
                raise ValueError(f"unknown step: {kind}")
            if isinstance(result, dict) and result.get("__interrupt__"):
                outcomes.append(
                    {"needs_approval": [i.value for i in result["__interrupt__"]]}
                )
            else:
                texts = [
                    m.content
                    for m in reversed(result.get("messages", []))
                    if getattr(m, "type", "") == "ai" and m.content
                ]
                outcomes.append({"answer": texts[0] if texts else ""})
        return outcomes
