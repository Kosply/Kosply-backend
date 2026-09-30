# config — implemented

File: `app/core/config/` (`config.py` + `dsn.py`, stdlib only, no dependency).
Mirrors `lib/server/config/env.js` strict PORT parsing.

| Key | Default | Notes |
|---|---|---|
| `PORT` | `8000` | digits only, 1–65535, else fallback |
| `DATABASE_URL` | — (empty) | set → Postgres checkpointer; empty → in-memory fallback |
| `KOSPLY_SERVER_URL` | `http://localhost:3000` | base URL tools call (trailing `/` stripped) |
| `AI_MODEL` | `openai:gpt-4o-mini` | `init_chat_model` id; provider creds (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, …) are read from env by the model client |
| `AI_MAX_WAITERS` | `200` | concurrent approval long-polls on `/ai/wait/:id`; full pool → `503` (waits hold no model slot) |
| `AI_MAX_INFLIGHT` | `50` | concurrent model calls / SSE streams |

## Rules

| Rule | Notes |
|---|---|
| `.env` loader | minimal built-in parser (`KEY=value`, skips blanks/comments); real env always wins |
| Frozen settings | `Settings` dataclass is immutable after load |
