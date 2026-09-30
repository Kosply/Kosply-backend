# ai proxy — implemented

Single backend for Flutter: JWT in, agent stream out. Identity always comes
from the token (body `user_id`/`role` ignored) to block persona spoofing.
Agent statuses pass through untouched.

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/ai/chat` | JWT | `conversation_id?`, `message`, `ui_state?` (screen snapshot) | agent body as-is + `callbacks[]` for Flutter | `401`, `503 AGENT_UNAVAILABLE` |
| POST | `/api/ai/chat/stream` | JWT | same as chat | SSE piped (`token`/`thinking`/`callback`/`interrupt`/`done`) | `401`, `503 AGENT_UNAVAILABLE` |
| POST | `/api/ai/chat/resume` | JWT | `conversation_id`, `approve` | agent body as-is | `401`, `503 AGENT_UNAVAILABLE` |
| GET | `/api/ai/conversations` | JWT | — | `200 {items}` own sessions, newest first (Prisma direct, no agent hop) | `401`, `503 DB_UNAVAILABLE` |
| GET | `/api/ai/wait/:id` | JWT | query `timeout` (1..1500, default 60) | agent body as-is: `{status: resolved\|timeout\|noop, answer, remainingS}` | `401`, `503 AGENT_UNAVAILABLE` |
| GET | `/api/ai/history/:id` | JWT | — | agent body as-is | `401`, `503 AGENT_UNAVAILABLE` |

## `/api/ai/wait/:id`

Long-poll for a pending approval so Flutter does not have to block on a fixed
sleep. Returns the instant the interrupt clears and always reports the
leftover budget:

| Case | Body |
|---|---|
| Approved while waiting | `200 {status: resolved, answer: "…", remainingS: 1380}` |
| Budget spent | `200 {status: timeout, answer: "", remainingS: 0}` |
| Nothing pending | `200 {status: noop, answer: "", remainingS: <timeout>}` |

Use it after a `409 needs_approval`: a 25-minute budget answered at minute 2
returns ~2 s later with the AI answer and `remainingS` ≈ 1380 for chaining.
Long waits need the phone alive in background (Android foreground service,
iOS background mode/push); in production prefer `timeout<=60` loops or push.
