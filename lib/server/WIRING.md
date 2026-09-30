# Kosply wiring map (db ↔ agent ↔ server)

Which box owns what, and what is reachable from the server today.
`✅ wired` = callable over HTTP with tests.

## db tables → server endpoints

| Table | Server endpoint(s) | Agent use | Status |
|---|---|---|---|
| `users` | `POST /api/auth/*`, `GET /api/users/me\|:id`, `PATCH /api/users/me`, `GET /api/internal/users/:id` | role lookup, persona | ✅ wired |
| `products` | `/api/products*` (public + seller, COD location writable), `/api/internal/products/*` | catalog tools | ✅ wired |
| `ai_conversations` | `GET /api/ai/conversations` (list), `GET /api/ai/history/:id` (via agent) | thread resume | ✅ wired |
| `ai_messages` | `GET /api/ai/history/:id` (via agent) | history render | ✅ wired |
| `seller_verifications` | `POST/GET /api/verifications*` (submit/me/list/review) | seller gating context | ✅ wired |
| `conversations` + `messages` (COD) | `/api/conversations*` (open/inbox/room/send/history) | handover target for contact flow | ✅ wired |
| `support_tickets` + `support_messages` | `/api/support/tickets*` (open/list/detail/reply/close) | escalation target | ✅ wired |
| `reports` | `/api/reports*` (file/list/review + enforcement) | fraud context | ✅ wired |
| `admins` | `POST /api/admin/login` | dashboard auth | ✅ wired |
| `users` (segmentation) | `POST/PATCH /api/admin/users*` (SUPER_ADMIN), `PATCH /api/admin/users/me` (photo/name/username, password locked) | — | ✅ wired |
| `notifications` + `notification_preferences` | `/api/notifications*` (inbox, read, free toggles) | — | ✅ wired |
| `password_resets` | `POST /api/auth/forgot-password|reset-password` | — | ✅ wired |
| `ai_models` | `GET /api/models` + ADMIN CRUD | selector source (client wiring TODO) | ✅ wired |

## agent → server calls

| Agent tool | Server endpoint | Status |
|---|---|---|
| `search_catalog` | `GET /api/internal/products/search` | ✅ wired (live-tested) |
| `get_product_detail` | `GET /api/internal/products/:id` | ✅ wired |
| `get_user_role` | `GET /api/internal/users/:id` | ✅ wired |
| `request_seller_contact` | `POST /api/internal/contact-requests` | ✅ wired (intake stub; delivery TODO) |

## server → agent calls

| Server endpoint | Agent endpoint | Status |
|---|---|---|
| `POST /api/ai/chat` | `POST /ai/chat` | ✅ wired (status passthrough) |
| `POST /api/ai/chat/stream` | `POST /ai/chat/stream` | ✅ wired (SSE piped) |
| `POST /api/ai/chat/resume` | `POST /ai/chat/resume` | ✅ wired |
| `GET /api/ai/wait/:id` | `GET /ai/wait/:id` | ✅ wired (long-poll; needs background app for long waits) |
| `GET /api/ai/history/:id` | `GET /ai/history/:id` | ✅ wired |
| `GET /api/ai/conversations` | Prisma direct (no agent hop) | ✅ wired |

## Rules

1. Flutter talks only to the server; identity always comes from the JWT.
2. Agent ↔ server talk HTTP on localhost; agent never touches Prisma tables
   except the `ai_*` history mirror (documented exception until the server
   owns those writes).
3. New wiring must add: server route + test + kosmon `Registry()` entry
   (GET) + a row in this file.
