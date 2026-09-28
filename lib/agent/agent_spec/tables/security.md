# security — implemented

Files: `app/core/ratelimit.py`, `app/core/caps.py`, error additions in
`app/core/errors.py`, `GET /readyz` in `app/api/routes.py`. Goal: one bad
or heavy caller can't take the process down (liveness first, then fairness).

| Guard | Where | Behavior |
|---|---|---|
| Rate limit | `ratelimit.py` middleware on `/ai/*` | sliding window (`AI_RATE_LIMIT_PER_MIN`, default 60); key = body `user_id` else client IP; over budget → `429 {code: RATE_LIMITED}` |
| Body cap | `caps.body_cap_middleware` (outermost) | `Content-Length` over `AI_MAX_BODY_BYTES` (default 1MB) → `413 {code: BODY_TOO_LARGE}` before parsing |
| In-flight cap | `caps.run_guarded` / `stream_guarded` | semaphore (`AI_MAX_INFLIGHT`, default 50); no slot within `AI_QUEUE_TIMEOUT_S` (default 5s) → `503 {code via ServerBusy}` |
| Run timeout | `run_guarded` | model call over `AI_MODEL_TIMEOUT_S` (default 120s) → `504` via `ModelTimeout` |
| Readiness | `GET /readyz` | postgres: `SELECT 1` ok → `200 ok`, fail → `503 down`; memory saver → `200 degraded` |
| Tool failures | `ToolNode(handle_tool_errors=True)` | failing tool becomes an error `ToolMessage` the agent explains, never a crashed turn |

## Rules

| Rule | Notes |
|---|---|
| Agent errors keep status | routes re-raise `AgentError` untouched (`except AgentError: raise`); only unknown exceptions become 500 |
| Single-process scope | limiter + semaphore live in memory; multi-worker needs Redis (TODO) |
| E2E proof | `tests/e2e/` runs the real chain agent → server → db (opt-in `E2E_LIVE=1`) |
