# memory — implemented

File: `app/agent/memory/checkpoint/` (`checkpointer.py`). Persistence is what makes
conversations resumable across turns **and** restarts.

| `DATABASE_URL` | Checkpointer | Resume survives restart |
|---|---|---|
| set | `AIOMySQLSaver` (tables auto-created via `setup()`) | yes |
| empty | `InMemorySaver` dev fallback | no (process memory only) |

> DSN note: non-MySQL params (`?schema=`, `?connection_limit=` …) are stripped
> by `mysql_dsn` (`app/core/config/`) before connecting; `mysql_conn_kwargs`
> parses the same URL into aiomysql/pymysql kwargs.

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
| MySQL `setup()` fails | `MemoryError` at boot (fail fast, fix DB before serving) |
