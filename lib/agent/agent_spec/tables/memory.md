# memory — implemented

File: `app/agent/memory/checkpointer.py`. Persistence is what makes
conversations resumable across turns **and** restarts.

| `DATABASE_URL` | Checkpointer | Resume survives restart |
|---|---|---|
| set | `AsyncPostgresSaver` (tables auto-created via `setup()`) | yes |
| empty | `InMemorySaver` dev fallback | no (process memory only) |

> DSN note: Prisma-style `?schema=public` is stripped by `app/core/dsn.py`
> (`pg_dsn`) before connecting — raw drivers reject unknown query params.

## Lifecycle

| Step | Where |
|---|---|
| `create_saver()` → `(saver, aclose)` | `memory/checkpointer.py` |
| `setup()` tables, compile graph once, store on `app.state` | `main.py` lifespan |
| `aclose()` on shutdown | `main.py` lifespan `finally` |
| Per-request key | `{"configurable": {"thread_id": conversation_id}}` |

## Failure mode

| Case | Result |
|---|---|
| Postgres `setup()` fails | `MemoryError` at boot (fail fast, fix DB before serving) |
