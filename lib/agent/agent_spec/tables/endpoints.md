# endpoints — implemented

All routes live in `app/api/routes.py`. Graph instance comes from
`request.app.state.graph` (compiled once in lifespan).

| Method | Path | Request | Success | Special |
|---|---|---|---|---|
| GET | `/` | — | `200 {name, status}` | load-balancer check |
| GET | `/health` | — | `200 {status, service}` | liveness probe |
| POST | `/ai/chat` | `{conversation_id, user_id, message}` | `200 {conversation_id, answer}` | `409 needs_approval` when a sensitive tool fires |
| POST | `/ai/chat/stream` | same as `/ai/chat` | SSE `token` / `interrupt` / `done` | stream ends right after `interrupt` |
| POST | `/ai/chat/resume` | `{conversation_id, approve}` | `200 {conversation_id, answer}` | `approve=true` runs the tool, `false` cancels it; `409` again if another interrupt fires |
| GET | `/ai/history/:id` | — | `200 {conversation_id, messages[{role, content}]}` | resume rendering in Flutter |

## Error mapping

| Case | HTTP | Body |
|---|---|---|
| Sensitive tool pending | `409` | `{status: needs_approval, interrupt: [{pending_tools: [...]}]}` |
| Model/tool/memory failure | `500` | `{status: error, message}` |
