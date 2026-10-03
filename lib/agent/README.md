# Kosply Agent

AI microservice: FastAPI + LangGraph. Isolated in `lib/agent/` from the
marketplace API — the two talk only over HTTP.

The agent never touches the marketplace database. Its tools call the server's
`/api/internal/*` API, which is guarded by a shared `INTERNAL_API_KEY`.

## Stack

- Python >= 3.10, FastAPI, uvicorn, SSE (`sse-starlette`)
- LangGraph 1.2 (`StateGraph`, `ToolNode`, `interrupt`/`Command`)
- Checkpointer: Postgres (`langgraph-checkpoint-postgres`) with in-memory fallback
- Model: any OpenAI-compatible provider via `init_chat_model` (`AI_MODEL`)
- Every `/ai/*` route requires `x-internal-key`; the agent fails closed when the
  key is unset. It is never published publicly — compose binds it to loopback.

## Structure (folders by function)

```
lib/agent/
  requirements.txt        # pinned manifest (this runtime only)
  .env.example            # PORT, DATABASE_URL, KOSPLY_SERVER_URL, AI_MODEL
  Dockerfile              # digest-pinned python, non-root (uid 10001), serves :8000
  agent_spec/             # feature specs in tables (mirror of implementation)
  app/
    main.py               # entrypoint: lifespan (memory setup + graph compile) + routes
    core/                 # cross-cutting, one folder per function
      config/             # config.py (strict env loader) + dsn.py (pg_dsn for raw drivers)
      errors/             # errors.py (AgentError hierarchy + handlers)
      limits/             # ratelimit.py (429) + caps.py (413 body cap, 503/504 bounded runs)
      security.py         # inbound x-internal-key check (fails closed)
      http.py             # OUTBOUND auth: every tool call carries x-internal-key
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
./scripts/agent/agent.sh install   # venv + runtime + dev requirements
./scripts/agent/agent.sh dev       # uvicorn --reload on :8000
./scripts/agent/agent.sh test      # pytest
./scripts/agent/agent.sh shell     # shell inside the venv
```

The config loader reads `.env` relative to the CWD, so starting uvicorn from the
repository root silently produced an empty configuration — a process that boots
"successfully" while answering 401 to all six of its own tools. The script exports
the repository `.env` into the child process instead, and refuses to start
without `INTERNAL_API_KEY`.

## Tests (no real AI — stateful fake only)

```bash
./scripts/agent/agent.sh test
```

- `tests/base_test.py` — `StatefulFakeChatModel` (canned replies, consumed in
  order) + `BaseAgentTest.loop()` which replays `send`/`approve` steps on one
  thread_id to exercise memory + resume.
- `tests/{graph,api,memory,policy,streaming,personas}/` — one folder per
  category (loop + approval, HTTP, history-store, policy, thinking, personas).
- `tests/message/` — all stateful-message tests (fake model, canned shapes).
- `tests/loop/` — loop-runner tests (outcomes, bad steps, thread isolation).
- `tests/security/` — inbound auth and thread ownership, outbound tool auth,
  rate limit, body cap, middleware order, bounded runs/streams.
- `tests/e2e/` — live wiring vs real server+DB (opt-in `E2E_LIVE=1`) + full lifecycle vs real model (opt-in `E2E_LIVE_AI=1`).
- `tests/ui/` — screen reading + callback responses/events.
- `tests/tools/` — catalog filters, negotiation tools (mocked HTTP).
- `tests/graph/test_approval_identity.py` — the guarantee that makes approval
  safe: an approved action acts as the session user, never as the model.

### Two invariants worth knowing

**Outbound calls authenticate.** All six tool calls route through
`app/core/http.py`, which attaches `x-internal-key`. They previously called
`httpx` directly, so every one returned 401 and surfaced as a `ToolError`: the
agent could hold a conversation and do nothing at all.
`tests/security/test_outbound_auth.py` fails if any tool reaches for raw
`httpx` again.

**Approval is consent for an action, not an identity.** The acting user for
`send_chat_message` and `request_seller_contact` comes from graph state
(`InjectedState`). Sourcing it from the tool arguments would turn "send this
message" into "send this message as anyone" — the exact attack approval exists
to prevent. See `agent_spec/tables/human_in_the_loop.md`.

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

## The system prompt

`app/agent/policy/scope/system_prompt.md` documents what a product is — every
field the tools return, `price` in rupiah, that search returns only `ACTIVE`
listings, that `Product.category` is free text typed by the seller (so filtering
by a tidy category word matches nothing), and that the model must call
`search_catalog` rather than recalling listings. Without it the model invents
products, prices and sellers.

Instructions are English (they are read by the model, not the user, and cost
fewer tokens); the persona blocks in `app/agent/policy/personas/` move with them.
The **reply** language is not pinned: the prompt tells the model to answer in
whatever language the user wrote in. The canned pre-LLM refusals are bilingual,
since no model is involved when they are returned.

`tests/policy/test_prompt_knowledge.py` pins all of this so the prompt cannot
silently regress.

## Known gaps

- `POST /api/internal/contact-requests` (the server side of
  `request_seller_contact`) validates and returns `202`, but creates no chat room
  and sends no notification. An approved "contact the seller" therefore does
  nothing yet.
- The checkpointer database must be migrated. `init.sql` creates `kosply_agent`
  empty on purpose, and the compose `migrate-agent` service builds its schema;
  without it every `/ai/*` request fails the ownership check with 503 while
  `/health` stays green.
- A pending approval interrupt has no TTL — an approval left open accumulates in
  the checkpointer until the thread is reused.
- No LLM-level prompt-injection filtering of tool *output*: a seller can put
  text in a product `description`. The blast radius is bounded because both write
  tools are approval-gated, and the prompt tells the model to treat descriptions
  as data, but it is not enforced in code.
