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
from langchain_core.messages import AIMessage, RemoveMessage, SystemMessage, ToolMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import REMOVE_ALL_MESSAGES
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.types import Command, interrupt

from .listing.card import (
    LISTING_PROMPT,
    ListingCardError,
    assemble_listing_card,
    cap_image_urls,
    message_text,
)
from .listing.photos import inline_own_uploads
from .memory import needs_compaction, summarize_history
from .state import AgentState
from .tools import SENSITIVE_TOOLS, TOOLS
from app.agent.policy import ensure_system_prompt


def _has_images(messages) -> bool:
    """True when a message carries an image block the model should actually see."""
    for message in messages:
        content = getattr(message, "content", None)
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "image_url":
                return True
    return False


def build_graph(checkpointer: object, model_name: str = "", llm: object = None,
                *, compaction_max_messages: int = 30, compaction_threshold_pct: float = 75.0,
                compaction_context_total: int = 32000, compaction_keep_recent: int = 6):
    """Compile the agent graph. The real model inits lazily on first use.

    Pass `llm` (e.g. a stateful fake in tests) to skip `init_chat_model`.
    Lazy init keeps boot green without provider keys; failures surface
    per-request as ModelError instead of crashing the process.
    Compaction budgets bound history size for small-window models.
    """
    bound = {
        "llm": llm.bind_tools(TOOLS) if llm is not None else None,
        # Listing calls the unbound model so a photo turn cannot emit a tool
        # call. Tests pass one fake; bind_tools returns that same object.
        "raw": llm,
    }

    def _llm():
        if bound["llm"] is None:
            raw = init_chat_model(model_name)
            bound["raw"] = raw
            bound["llm"] = raw.bind_tools(TOOLS)
        return bound["llm"]

    def _raw():
        if bound["raw"] is None:
            _llm()
        return bound["raw"]

    async def _for_model(messages):
        """Copy sent to the model. Upload URLs become bytes; the checkpoint keeps the URLs."""
        if not _has_images(messages):
            return messages
        return await inline_own_uploads(messages)

    async def agent(state: AgentState) -> dict:
        """LLM node: compact when over budget, then answer or emit tool calls."""
        role = state.get("user_role", "UNKNOWN")
        messages = state["messages"]
        if needs_compaction(messages, max_messages=compaction_max_messages,
                            threshold_pct=compaction_threshold_pct,
                            context_total=compaction_context_total):
            cutoff = max(len(messages) - compaction_keep_recent, 0)
            summary = await summarize_history(messages[:cutoff] or messages, _llm())
            kept = messages[cutoff:]
            visible = await _for_model([summary, *kept])
            response = await _llm().ainvoke(ensure_system_prompt(visible, role))
            return {"messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES), summary, *kept, response]}
        visible = await _for_model(messages)
        response = await _llm().ainvoke(ensure_system_prompt(visible, role))
        return {"messages": [response]}

    async def listing(state: AgentState) -> dict:
        """One card from the side photos. Price and stock stay unset."""
        photos = cap_image_urls(state.get("image_urls") or [])
        # Photos on the Kosply server travel as bytes, not URLs: a hosted model
        # cannot reach the LAN address a phone uploads to in development. The
        # checkpoint keeps the URLs; only this model call carries the bytes.
        history = await inline_own_uploads(state["messages"])
        response = await _raw().ainvoke(
            [SystemMessage(content=LISTING_PROMPT), *history]
        )
        try:
            card = assemble_listing_card(photos, message_text(response.content))
        except ListingCardError as exc:
            raise ListingCardError("listing card is empty") from exc
        summary = f"{card['title']}\n\n{card['description']}"
        return {
            "messages": [AIMessage(content=summary)],
            "listing_card": card,
            "listing_mode": "chat",
            "image_urls": [],
        }

    def listing_price(state: AgentState) -> dict:
        """Write the user's price and stock onto the card the photos already filled."""
        previous = state.get("listing_card") or {}
        card = assemble_listing_card(
            previous.get("imageUrls") or [],
            None,
            price=state.get("listing_price"),
            stock=state.get("listing_stock"),
            previous=previous,
        )
        answer = (
            f"Harga Rp{card['price']} dan stok {card['stock']} dicatat. "
            "Judul, deskripsi, dan kategori tetap dari foto."
        )
        return {
            "messages": [AIMessage(content=answer)],
            "listing_card": card,
            "listing_mode": "chat",
        }

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

    def route_turn(state: AgentState) -> str:
        """Listing only when this turn carries side photos or a price and stock.

        A text turn leaves `listing_mode` unset and stays on the chatbot node.
        """
        mode = state.get("listing_mode") or "chat"
        if mode == "photos" and (state.get("image_urls") or []):
            return "listing"
        if mode == "price" and state.get("listing_card"):
            return "listing_price"
        return "agent"

    builder = StateGraph(AgentState)
    builder.add_node("agent", agent)
    builder.add_node("listing", listing)
    builder.add_node("listing_price", listing_price)
    builder.add_node("human_approval", human_approval)
    # Catch-all tool errors: a failing tool becomes an error ToolMessage the
    # agent can explain, never a crashed turn. (Default only catches ToolException.)
    builder.add_node("tools", ToolNode(TOOLS, handle_tool_errors=True))
    builder.add_conditional_edges(
        START,
        route_turn,
        {"listing": "listing", "listing_price": "listing_price", "agent": "agent"},
    )
    builder.add_edge("listing", END)
    builder.add_edge("listing_price", END)
    builder.add_conditional_edges("agent", tools_condition, {"tools": "human_approval", END: END})
    builder.add_edge("tools", "agent")
    return builder.compile(checkpointer=checkpointer)
