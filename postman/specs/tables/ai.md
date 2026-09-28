# ai proxy — implemented

Single backend for Flutter: JWT in, agent stream out. Identity always comes
from the token (body `user_id`/`role` ignored) to block persona spoofing.
Agent statuses pass through untouched.

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/ai/chat` | JWT | `conversation_id?` (fresh UUID if empty), `message` | agent body as-is | `401`, `503 AGENT_UNAVAILABLE` |
| POST | `/api/ai/chat/stream` | JWT | same as chat | SSE piped (`token`/`thinking`/`interrupt`/`done`) | `401`, `503 AGENT_UNAVAILABLE` |
| POST | `/api/ai/chat/resume` | JWT | `conversation_id`, `approve` | agent body as-is | `401`, `503 AGENT_UNAVAILABLE` |
| GET | `/api/ai/conversations` | JWT | — | `200 {items}` own sessions, newest first (Prisma direct, no agent hop) | `401`, `503 DB_UNAVAILABLE` |
| GET | `/api/ai/history/:id` | JWT | — | agent body as-is | `401`, `503 AGENT_UNAVAILABLE` |
