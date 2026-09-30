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
    core/                 # cross-cutting, one folder per function
      config/             # config.py (strict env loader) + dsn.py (pg_dsn for raw drivers)
      errors/             # errors.py (AgentError hierarchy + handlers)
      limits/             # ratelimit.py (429) + caps.py (413 body cap, 503/504 bounded runs)
    api/                  # HTTP layer, one folder per function (+ shared.py helpers)
      chat/               # routes.py (chat/stream/resume/wait), schemas.py, streaming.py (SSE)
      history/            # routes.py + schemas.py (stored session reads)
      health/             # routes.py (liveness + readiness probes)
    agent/                # LangGraph layer
      state.py            # AgentState(MessagesState) — history reducer, enables resume
      graph.py            # agent -> human_approval -> tools, compiled with checkpointer
      policy/             # scope/ (system_prompt.md, rules.py, guard.py) + personas/ (SELLER/BUYER)
      tools/              # registry.py + one folder per group: catalog, chat, contact, roles, ui
      memory/             # checkpoint/ (persistent saver), history/ (db mirror), compaction/ (summaries)
      models/             # registry.py (provider context-window lookup, cached)
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
- `tests/{graph,api,memory,policy,streaming,personas}/` — one folder per
  category (loop + approval, HTTP, history-store, policy, thinking, personas).
- `tests/message/` — all stateful-message tests (fake model, canned shapes).
- `tests/loop/` — loop-runner tests (outcomes, bad steps, thread isolation).
- `tests/security/` — rate limit, body cap, bounded runs/streams.
- `tests/e2e/` — live wiring vs real server+DB (opt-in `E2E_LIVE=1`) + full lifecycle vs real model (opt-in `E2E_LIVE_AI=1`).
- `tests/ui/` — screen reading + callback responses/events.
- `tests/tools/` — catalog price/category filters (mocked HTTP).

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness |
| POST | `/ai/chat` | one turn; `409 needs_approval` when a sensitive tool fires |
| POST | `/ai/chat/stream` | SSE: `token` / `thinking` / `interrupt` / `done` |
| POST | `/ai/chat/resume` | `{approve: bool}` continues after an interrupt |
| GET | `/ai/wait/:conversation_id` | `?timeout=1..1500` long-polls a pending approval → `{status, answer, remainingS}` |
| GET | `/ai/history/:id` | stored messages (resume rendering in Flutter) |

Resume key = `thread_id` = `conversation_id` = `ai_conversations.id`
(server writes those tables; the agent persists LangGraph checkpoints
separately under the same id).

## TODO (next phases)

- Server: `GET /internal/products/search`, `GET /internal/products/:id`,
  `POST /internal/contact-requests` (tools point at these).
- `ai_models`: add `provider` + `base_url` so the registry drives the client.
- Auth: user JWT on `/ai/*`, admin key on model management.
