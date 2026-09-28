# Kosply Agent Spec

Source: `lib/agent/` (FastAPI + LangGraph 1.2, basic). Status: **implemented** —
everything below exists in code, compiles, and is covered by `pytest tests/`
(54 passed, 2 skipped e2e; stateful fake only, no real AI; mirror + e2e verified live on Postgres).

## Feature index

| Feature | Spec file | Status |
|---|---|---|
| HTTP endpoints | `tables/endpoints.md` | implemented |
| LangGraph graph (nodes/edges/classes) | `tables/graph.md` | implemented |
| Tools (catalog, contact) | `tables/tools.md` | implemented (basic) |
| Persistence-memory (resume) | `tables/memory.md` | implemented |
| History-store (agent ↔ db mirror) | `tables/history_store.md` | implemented |
| Policy (injection + scope hardening) | `tables/policy.md` | implemented |
| Personas (seller/buyer modes) | `tables/personas.md` | implemented |
| Security (limits, caps, readiness) | `tables/security.md` | implemented |
| Model selector (UI → db → agent) | `tables/model_selector.md` | planned |
| SSE streaming-conversation | `tables/streaming.md` | implemented |
| Human-in-the-loop (interrupt/resume) | `tables/human_in_the_loop.md` | implemented |
| Error hierarchy → HTTP mapping | `tables/errors.md` | implemented |
| Tests (base_test loop, fakes) | `tables/tests.md` | implemented |
| Env config | `tables/config.md` | implemented |

## Resume key convention

| Concept | Value |
|---|---|
| LangGraph `thread_id` | `conversation_id` from the request |
| DB session | `ai_conversations.id` (same string) |
| History source (agent) | checkpointer state under `thread_id` |
| History source (server) | `ai_messages` rows (written by server, phase next) |

## Global rules

1. Tools call the Kosply server internal HTTP API, never the DB directly.
2. Sensitive tools never run without `approve` (interrupt → 409 → resume).
3. No real AI in tests — `StatefulFakeChatModel` only.
4. Prices/models stay in `ai_models` (DB); the agent only carries `model` as a string.
