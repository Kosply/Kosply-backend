# Kosply Agent

AI microservice: FastAPI + LangGraph (basic). Lives in `lib/agent/` so it
stays isolated from the marketplace API — they talk over HTTP.

## Stack

- Python >= 3.10, FastAPI, uvicorn, SSE (`sse-starlette`)
- LangGraph 1.2 (`StateGraph`, `ToolNode`, `interrupt`/`Command`)
- Checkpointer: Postgres (`langgraph-checkpoint-postgres`) with in-memory fallback
- Model: any OpenAI-compatible provider via `init_chat_model` (`AI_MODEL`)

## Structure (folders by function)

```
lib/agent/
  requirements.txt        # pinned manifest (this runtime only)
  .env.example            # PORT, DATABASE_URL, KOSPLY_SERVER_URL, AI_MODEL
  Dockerfile              # python:3.12-slim, serves :8000
  agent_spec/             # feature specs in tables (mirror of implementation)
  app/
    main.py               # entrypoint: lifespan (memory setup + graph compile) + routes
    core/                 # cross-cutting: config, errors
      config.py           # env loader (strict PORT, like lib/server/config/env.js)
      dsn.py              # pg_dsn: strip Prisma-only params (?schema=) for raw drivers
      errors.py           # AgentError hierarchy + handlers (409 = needs approval)
    api/                  # HTTP layer
      routes.py           # /health, /ai/chat, /ai/chat/stream, /ai/chat/resume, /ai/history/:id
      schemas.py          # pydantic request/response
      streaming.py        # SSE: token / interrupt / done events
    agent/                # LangGraph layer
      state.py            # AgentState(MessagesState) — history reducer, enables resume
      graph.py            # agent -> human_approval -> tools, compiled with checkpointer
      policy/             # rules.py (scope+injection), guard.py (pre-check+prompt)
      tools/              # basic tools: catalog.py (read-only), contact.py (sensitive)
      memory/             # checkpointer.py (Postgres persistent, memory fallback)
                          # history_store.py (mirror turns into ai_conversations/ai_messages)
```

## Run

```bash
cd lib/agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --port 8000
```

## Tests (no real AI — stateful fake only)

```bash
.venv/bin/python -m pytest tests/ -v
```

- `tests/base_test.py` — `StatefulFakeChatModel` (canned replies, consumed in
  order) + `BaseAgentTest.loop()` which replays `send`/`approve` steps on one
  thread_id to exercise memory + resume.
- `tests/test_graph.py` — plain answer, interrupt→approve, interrupt→reject,
  history across turns.
- `tests/test_api.py` — health, chat approval flow, SSE stream, history.
- `tests/test_policy.py` — injection refusals, scope prompt wiring, route refusals.
- `tests/test_history_store.py` — role mapping, off-mode no-op.
- `tests/test_streaming.py` — thinking split (unit) + thinking SSE (integration).

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness |
| POST | `/ai/chat` | one turn; `409 needs_approval` when a sensitive tool fires |
| POST | `/ai/chat/stream` | SSE: `token` / `thinking` / `interrupt` / `done` |
| POST | `/ai/chat/resume` | `{approve: bool}` continues after an interrupt |
| GET | `/ai/history/:id` | stored messages (resume rendering in Flutter) |

Resume key = `thread_id` = `conversation_id` = `ai_conversations.id`
(server writes those tables; the agent persists LangGraph checkpoints
separately under the same id).

## TODO (next phases)

- Server: `GET /internal/products/search`, `GET /internal/products/:id`,
  `POST /internal/contact-requests` (tools point at these).
- `ai_models`: add `provider` + `base_url` so the registry drives the client.
- Auth: user JWT on `/ai/*`, admin key on model management.
