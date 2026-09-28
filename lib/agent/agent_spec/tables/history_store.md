# history-store — implemented

File: `app/agent/memory/history_store.py`. Connects `lib/agent` ↔ `lib/db`:
every finished turn is mirrored into the shared tables, and resume/history
reads from them first.

| Function | Does |
|---|---|
| `ensure_conversation(id, user_id, title)` | `INSERT … ON CONFLICT DO NOTHING` into `ai_conversations` (title = first message, truncated) |
| `append_message(id, role, content, model?)` | one `ai_messages` row + bumps `lastMessageAt`; tool rows skipped |
| `load_history(id)` | `ai_messages` ordered by `createdAt` → `[{role, content}]` (roles back-mapped to human/ai/system) |
| `sync_turn(id, user_id, message, answer)` | ensure + user row + assistant row; warns and continues on failure |

## Wiring

| Endpoint | Mirror behavior |
|---|---|
| `POST /ai/chat` | after a clean turn: user message + answer |
| `POST /ai/chat/resume` | answer only (user side already stored) |
| `GET /ai/history/:id` | shared tables first; checkpointer snapshot fallback |

## Role mapping

| Agent side | `AiMessageRole` |
|---|---|
| `human` | `USER` |
| `ai` | `ASSISTANT` |
| `system` | `SYSTEM` |
| `tool` | skipped (internal only) |

## Rules

| Rule | Notes |
|---|---|
| Same Postgres, same tables | raw SQL via `psycopg` async; column names quoted (`"userId"`, `"conversationId"`, enum cast `::"AiMessageRole"`) |
| Best-effort | off without `DATABASE_URL`; failures (e.g. missing user row for the FK) warn, never break chat |
| Ids | conversation id comes from the client (`thread_id`); message ids are random hex (TEXT pk accepts non-cuid) |
| Owner stays server-side | once server internal endpoints exist, it becomes the writer and the agent mirror is dropped (TODO) |
