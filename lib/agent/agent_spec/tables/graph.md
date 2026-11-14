# graph — implemented

File: `app/agent/graph.py`. Basic ReAct loop compiled **with** a checkpointer,
so every turn is persisted and resumable.

## Nodes

| Node | Type | Does |
|---|---|---|
| `agent` | async LLM node | chatbot path: calls the bound model on `state["messages"]`, returns the response (answer or tool calls) |
| `listing` | async LLM node | photo path: unbound model sees the side photos and returns one product card. No tools. See `listing.md` |
| `listing_price` | plain node | writes the user's `price` and `stock` onto the card already in state. Does not call the model |
| `human_approval` | gate node | plain tools → `Command(goto="tools")`; sensitive tools → `interrupt()` → approve goes to `tools`, reject appends `ToolMessage("User rejected…")` and goes back to `agent` |
| `tools` | `ToolNode(TOOLS)` | executes approved/plain tool calls, returns `ToolMessage`s |

## Edges

| From | Via | To |
|---|---|---|
| `START` | `route_turn` | `listing` (`photos`) / `listing_price` (`price` and a card exists) / `agent` (text) |
| `listing` | edge | `END` |
| `listing_price` | edge | `END` |
| `agent` | `tools_condition` | `human_approval` (tools) / `END` (plain answer) |
| `human_approval` | `Command` | `tools` / `agent` |
| `tools` | edge | `agent` |

## LangGraph classes used (reference: langgraph docs)

| Class / function | Import | Role here |
|---|---|---|
| `StateGraph` | `langgraph.graph` | graph wiring |
| `START`, `END` | `langgraph.graph` | entry / terminal nodes |
| `MessagesState` | `langgraph.graph` | base of `AgentState` — history + `add_messages` reducer |
| `ToolNode`, `tools_condition` | `langgraph.prebuilt` | tool execution + routing |
| `interrupt`, `Command` | `langgraph.types` | pause for approval + resume/goto |
| `init_chat_model` | `langchain.chat_models` | provider-agnostic model (`AI_MODEL`) |
| `ToolMessage`, `HumanMessage` | `langchain_core.messages` | tool results / user turns |
| `tool` | `langchain_core.tools` | tool decorator |
| `InMemorySaver` / `AIOMySQLSaver` | `langgraph.checkpoint.memory` / `langgraph.checkpoint.mysql.aio` | persistence (see `memory.md`) |
| `InMemorySaver` | `langgraph.checkpoint.memory` | dev fallback, also used by tests |

## State

| Field | Type | Notes |
|---|---|---|
| `messages` | `Messages` (inherited) | full turn history, reducer-appended |
| `user_id` | `str` | passthrough for future per-user policy |
| `user_role` | `str` | persona role (`SELLER` / `BUYER` / other) |
| `ui_state` | `dict` | Flutter screen snapshot |
| `listing_mode` | `str` | `chat` / `photos` / `price` for this turn |
| `image_urls` | `list` | side-photo URLs for a `photos` turn (empty otherwise) |
| `listing_price` | `int` | user rupiah price on a `price` turn |
| `listing_stock` | `int` | user quantity on a `price` turn (`products.stock`) |
| `listing_card` | `dict` | draft card kept on the thread until the user sets price and stock |
