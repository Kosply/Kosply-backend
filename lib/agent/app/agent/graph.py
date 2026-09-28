"""Basic ReAct graph: agent -> human_approval -> tools.

LangGraph classes used (reference: langgraph docs):
- `StateGraph`, `START`, `END` ......... graph wiring
- `MessagesState` (via state.py) ........ message history + reducer
- `ToolNode`, `tools_condition` ......... tool execution + routing
- `interrupt`, `Command` ................ human-in-the-loop + resume

Flow: user message -> agent (LLM + bound tools) -> needs tools?
yes -> human_approval (interrupt when sensitive) -> tools -> agent ...
no -> END. Compiled WITH a checkpointer, so every turn is persisted
under `thread_id` (= conversation id) and can be resumed later.
"""

from langchain.chat_models import init_chat_model
from langchain_core.messages import ToolMessage
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.types import Command, interrupt

from .state import AgentState
from .tools import SENSITIVE_TOOLS, TOOLS
from app.agent.policy.guard import ensure_system_prompt


def build_graph(checkpointer: object, model_name: str = "", llm: object = None):
    """Compile the agent graph. Model is lazy: no network call happens here.

    Pass `llm` (e.g. a stateful fake in tests) to skip `init_chat_model`.
    """
    llm = (llm if llm is not None else init_chat_model(model_name)).bind_tools(TOOLS)

    async def agent(state: AgentState) -> dict:
        """LLM node: answer or emit tool calls (always under the Kosply scope prompt)."""
        response = await llm.ainvoke(ensure_system_prompt(state["messages"]))
        return {"messages": [response]}

    def human_approval(state: AgentState) -> Command:
        """Gate sensitive tools behind `interrupt()`; plain tools pass through."""
        last = state["messages"][-1]
        calls = getattr(last, "tool_calls", None) or []
        sensitive = [c for c in calls if c.get("name") in SENSITIVE_TOOLS]
        if not sensitive:
            return Command(goto="tools")
        decision = interrupt(
            {
                "pending_tools": [
                    {"name": c["name"], "args": c.get("args", {})} for c in sensitive
                ]
            }
        )
        if str(decision).lower() == "approve":
            return Command(goto="tools")
        return Command(
            goto="agent",
            update={
                "messages": [
                    ToolMessage(content="User rejected this action.", tool_call_id=c["id"])
                    for c in sensitive
                ]
            },
        )

    builder = StateGraph(AgentState)
    builder.add_node("agent", agent)
    builder.add_node("human_approval", human_approval)
    builder.add_node("tools", ToolNode(TOOLS))
    builder.add_edge(START, "agent")
    builder.add_conditional_edges("agent", tools_condition, {"tools": "human_approval", END: END})
    builder.add_edge("tools", "agent")
    return builder.compile(checkpointer=checkpointer)
