# memory — implemented

File: `app/agent/memory/checkpoint/` (`checkpointer.py`). Persistence is what makes
conversations resumable across turns **and** restarts.

| `DATABASE_URL` | Checkpointer | Resume survives restart |
|---|---|---|
| set | `AsyncPostgresSaver` (tables auto-created via `setup()`) | yes |
| empty | `InMemorySaver` dev fallback | no (process memory only) |

> DSN note: Prisma-style `?schema=public` is stripped by `pg_dsn`
> (`app/core/config/`) before connecting — raw drivers reject unknown params.

## Lifecycle

| Step | Where |
|---|---|
| `create_saver()` → `(saver, aclose)` | `memory/checkpoint/checkpointer.py` |
| `setup()` tables, compile graph once, store on `app.state` | `main.py` lifespan |
| `aclose()` on shutdown | `main.py` lifespan `finally` |
| Per-request key | `{"configurable": {"thread_id": conversation_id}}` |

## Failure mode

| Case | Result |
|---|---|
| Postgres `setup()` fails | `MemoryError` at boot (fail fast, fix DB before serving) |
