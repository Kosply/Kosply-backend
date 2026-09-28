# graph — implemented

File: `app/agent/graph.py`. Basic ReAct loop compiled **with** a checkpointer,
so every turn is persisted and resumable.

## Nodes

| Node | Type | Does |
|---|---|---|
| `agent` | async LLM node | calls the bound model on `state["messages"]`, returns the response (answer or tool calls) |
| `human_approval` | gate node | plain tools → `Command(goto="tools")`; sensitive tools → `interrupt()` → approve goes to `tools`, reject appends `ToolMessage("User rejected…")` and goes back to `agent` |
| `tools` | `ToolNode(TOOLS)` | executes approved/plain tool calls, returns `ToolMessage`s |

## Edges

| From | Via | To |
|---|---|---|
| `START` | edge | `agent` |
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
| `PostgresSaver` / `AsyncPostgresSaver` | `langgraph.checkpoint.postgres(.aio)` | persistence (see `memory.md`) |
| `InMemorySaver` | `langgraph.checkpoint.memory` | dev fallback, also used by tests |

## State

| Field | Type | Notes |
|---|---|---|
| `messages` | `Messages` (inherited) | full turn history, reducer-appended |
| `user_id` | `str` | passthrough for future per-user policy |
