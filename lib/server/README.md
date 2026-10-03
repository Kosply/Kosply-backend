# Kosply Server

Express API powering Kosply — the whole public surface. Flutter talks only to
this process; the AI agent is internal and never exposed directly.

## Stack

- Node >=18, Express 4 (stable)
- helmet, cors, compression, morgan, dotenv
- PM2 process manager (see root `ecosystem.config.js`)

## Structure

```
lib/server/
  server.js             # entrypoint: bind port + graceful shutdown
  app.js                # Express setup (global middleware, route mount)
  config/env.js         # env loader (PORT, NODE_ENV, CORS_ORIGIN, JWT_*, AI_AGENT_URL)
  config/db.js          # lazy Prisma access (null-safe, 503 when down)
  routes/<domain>/      # index.js aggregator + one folder per domain
  controllers/<domain>/ # per-module logic (req/res)
  services/<domain>/    # business logic (validation, Prisma, enforcement)
  middlewares/          # notFound (404), errorHandler (central), asyncHandler
  middlewares/auth/     # JWT authenticate + optionalAuthenticate + requireRole
  middlewares/internalKey.js   # x-internal-key guard for /api/internal/*
  middlewares/rateLimit.js     # fixed-window limiter, dependency-free
  middlewares/errorCatalog.js  # error codes (add codes here, never inline)
  tests/<domain>/       # node:test suites (`npm test` from the root)
  tests/shared/         # cross-cutting suites (error catalog + handlers)
```

Domains: `auth` (incl. password reset), `products`, `analytics`, `ai` (incl. internal),
`verifications`, `chat` (COD), `support`, `reports`, `admin`, `models`.
Shared roots only: `health.*`, pipeline middlewares, `config/`.

`server.js` binds the port; `app.js` only builds the app (no binding),
so the app stays importable for tests and PM2 cluster mode stays
predictable. Error flow: route → `asyncHandler` → controller → `next(err)` →
`errorHandler`; unknown paths fall into `notFound` first.

## Code documentation

All files use NatSpec-style docblocks (`@title`, `@notice`, `@dev`,
`@param`, `@return`) so behavior and contracts sit right above the code.

## Env

| Key | Required | Local | Staging (PM2) | Main (PM2) |
|---|---|---|---|---|
| `DATABASE_URL` | yes | `kosply_dev` | `kosply_staging` | `kosply_main` |
| `JWT_SECRET` | yes in production | — | — | — |
| `INTERNAL_API_KEY` | yes | shared with the agent | same | same |
| `NODE_ENV` | no | `development` | `staging` | `production` |
| `PORT` | no | `3000` | `3001` | `3000` |
| `TRUST_PROXY_HOPS` | no | `0` | behind the LB | behind the LB |
| `CORS_ORIGIN` | no | `*` | real origin | real origin |

Resolution order: PM2 `env` → `.env` file → defaults in `config/env.js`
(dotenv never overrides existing variables, so PM2 always wins).

A production boot without `JWT_SECRET`, or with the published dev fallback,
**fails**. It previously signed tokens with a value committed to this
repository, which was a complete authentication bypass.

`PORT` is strictly validated (digits only, 1-65535, fallback `3000`).
`TRUST_PROXY_HOPS` is parsed as a boolean-safe integer and defaults to `0` — it
was the string `"false"`, which is truthy. Body limits are `1mb`; `trust proxy`
is only correct behind a proxy you control, since it decides which
`X-Forwarded-For` entry is the client.

## Run

```bash
# From the project root:
npm run dev             # watch mode on :3000 (.env)
npm run dev:staging     # staging simulation on :3001
npm start               # single instance on :3000

# PM2 (recommended) — staging first, main after it passes:
./scripts/server.sh staging
./scripts/server.sh main
```

## Endpoints

- `GET /` → `{ name, status, env }` (root health for PM2 / load balancer)
- `GET /api/health` → `{ status, service, uptime, timestamp }`
- `GET /api/internal/products/search?q=&limit=` → `{ status, items }` (agent)
- `GET /api/internal/products/:id` → `{ status, item }` (agent)
- `GET /api/internal/users/:id` → `{ status, item }` public fields only (agent)
- `POST /api/internal/contact-requests` → `{ status: queued }` intake stub (agent)

## Auth & products (public API)

- `POST /api/auth/register` → buyer register, `{ user, token }` (201)
- `POST /api/auth/login` → email + password login, `{ user, token }`
- `POST /api/auth/google` → direct Google (`idToken`), `{ user, token, onboardingRequired, isNew }`
- `POST /api/auth/apple` → direct Apple (`identityToken` + names), same shape — **disabled by default** (`APPLE_LOGIN_ENABLED=true` when iOS ships; needs paid Apple Developer)
- `GET /api/products` → public catalog (`q?`, `limit?`)
- `GET /api/products/:id` → public detail
- `POST /api/products` → seller create (JWT + role SELLER)
- `PATCH /api/products/:id` → owner or ADMIN update
- `DELETE /api/products/:id` → soft archive (owner or ADMIN)
- `PATCH /api/products/:id/sold` → mark sold (owner or ADMIN); stamps `soldAt`, zeroes `stock`, idempotent

## Analytics (seller catalog numbers)

- `POST /api/analytics/products/:id/event?type=IMPRESSION|CLICK&source=feed|search|share|detail` → record an event (public; optional JWT attributes the viewer)
- `GET /api/analytics/seller?days=1..365` → per-product rows + catalog totals (JWT, own catalog only)
- `GET /api/analytics/products/:id?days=1..365` → one product (owner or ADMIN)

Metrics per product: `impressions`, `clicks`, `clickThroughRate` (clicks /
impressions), `inquiries` (distinct buyer chat rooms), `inquiryMessages`
(buyer-authored bubbles only, so a chatty seller cannot inflate their own
number), `sales`, `salesValue`, `conversionRate` (sales / clicks). Totals are
always re-derived from the item rows, never accumulated separately.

Inquiries and sales are **derived**, not stored: inquiries come from
`Conversation` + buyer `Message` rows, sales from the immutable `Product.soldAt`
stamped by `PATCH /products/:id/sold`. Only impressions/clicks need a new table
(`ProductEvent`).

Keying sales off the mutable `status` instead was two bugs at once: nothing
windowed them, so a sale from two years ago read as "sales today"; and archiving
a listing erased a completed sale from the dashboard while editing its price
retroactively rewrote the recorded value.

There is deliberately **no** platform revenue/profit math — Kosply is COD and
money moves off-platform, so `salesValue` is the seller's own gross only.

POC limits, revisit before production:
- The ingest dedupe window is in-process (`Map` + TTL), so it resets on restart
  and is per-PM2-worker. The viewer key is a hash of the socket address, not
  `req.ip` — with `trust proxy` on, `req.ip` is a client-chosen header.
- Anonymous ingest is rate limited to 120/min per client, but the limiter is
  per-process, so the real ceiling is roughly `limit × instances`.
- Feed/search surfaces are **not** auto-instrumented. Implicit writes on
  anonymous routes are a free amplification vector; the client fires events
  explicitly instead.
- `sellerOverview` caps at 500 active products per seller (`VALIDATION` beyond),
  and products are scoped by *activity* — created, sold, or traffic in the
  window. Filtering on `createdAt >= from` hid the sale of a listing uploaded
  200 days ago and sold today, so a 7-day window reported nothing at all.

## Verification, chat, support, reports, admin, password, models, users, notifications

- `POST /api/verifications` → submit KTM application (JWT)
- `GET /api/verifications/me` → own application status
- `GET /api/verifications` + `POST /api/verifications/:id/review` → ADMIN list + APPROVE/REJECT (approve promotes to SELLER)
- `POST /api/conversations` → open/reuse COD room (`productId` or `sellerId`, optional first `message`)
- `GET /api/conversations` → own inbox; `GET /:id` room; `POST /:id/messages` send; `GET /:id/messages` history (marks read)
- `POST /api/support/tickets` → open (`category/subject/description`, `ticketNo KSP-…`); `GET` list; `GET /:id` detail (internal notes hidden); `POST /:id/messages` reply; `POST /:id/close`
- `POST /api/reports` → file fraud (`RPT-…`); `GET /api/reports` + `POST /:id/review` ADMIN (WARNING / DELETE_PRODUCT archives / BAN_USER freezes seller)
- `POST /api/admin/login` → dashboard login (separate `admins` table)
- `PATCH /api/admin/users/me` → own photo/name/username (password locked)
- `POST /api/admin/users` + `PATCH /api/admin/users/:id` → SUPER_ADMIN manages admins (incl. freeze via `isActive`)
- `GET /api/users/me` + `PATCH /api/users/me` → own profile (name/username/bio/photo)
- `GET /api/users/:id` → public profile
- `GET /api/notifications` + `/preferences` + `POST /:id/read|read-all` + `PATCH /preferences` → personal inbox, free toggles
- `POST /api/auth/forgot-password` → always 200, 4-digit OTP (`devCode` outside production until email delivery lands)
- `POST /api/auth/reset-password` → verify code + set new password (single-use, 5 tries)
- `GET /api/models` → active AI models for the Flutter selector
- `POST/PATCH/DELETE /api/models` → ADMIN registry (delete refused when history references the model)

Auth uses `Authorization: Bearer <token>` (`middlewares/auth.js`); login is
email-only. `authenticate` re-reads `role` and `isActive` from the database on
every request and pins `alg` to HS256, so a ban takes effect immediately instead
of when the token expires. Dashboard tokens (`kind: 'admin'`) resolve against
`admins`, user tokens against `users`; the namespaces are disjoint and the token
says which to use.

## Rate limits

Per surface, not one global number. `middlewares/rateLimit.js` is a
dependency-free fixed-window limiter returning 429 with `RateLimit-*` and
`Retry-After`.

| Route | Limit | Keyed on |
|---|---|---|
| `POST /api/auth/login` | 10 / 15 min | IP **and** normalised email |
| `POST /api/auth/forgot-password` | 5 / 15 min | IP and email |
| `POST /api/auth/reset-password` | 10 / 15 min | IP and email |
| `POST /api/auth/register` | 10 / hour | IP |
| `POST /api/auth/google` · `/apple` | 20 / min | IP |
| `POST /api/analytics/products/:id/event` | 120 / min | IP |

Login is keyed on the account as well as the socket because IP-only limiting
does not stop credential stuffing from a botnet, and normalising the email stops
`User@x.com` buying a second set of guesses. The reset flow is tightest because
a 4-digit code is brute-forceable by construction.

Counters are per-process and in memory, so under PM2 the ceiling is roughly
`limit × instances` and a restart clears everything. A multi-node deployment
needs a shared store. `RATE_LIMIT=off` disables throttling; the test suite uses
it, and `tests/shared/rate_limit.test.js` re-enables it and asserts the real
behaviour.

## AI proxy (single backend for Flutter)

- `POST /api/ai/chat` → one turn (JWT identity forwarded, never body identity)
- `POST /api/ai/chat/stream` → SSE piped from the agent
- `POST /api/ai/chat/resume` → approve/reject passthrough
- `GET /api/ai/wait/:id?timeout=N` → long-poll a pending approval (1..120 s)
- `GET /api/ai/conversations` → own session list (Flutter history list)
- `GET /api/ai/history/:id` → history passthrough

Needs `AI_AGENT_URL` (default `http://localhost:8000`); agent down gives
`503 AGENT_UNAVAILABLE` while everything else keeps serving.

### What the proxy does not do

- **It does not relay the agent's error text.** The agent wraps unknown
  exceptions as `raise ModelError(str(exc))`, and httpx/provider exception
  strings carry the base URL, model id, request ids and truncated request
  payloads. A non-2xx becomes a catalog error with a fixed message; the agent's
  text goes to the server log.
- **It does not trust the client's identity.** `user_id` and `role` always come
  from the JWT; body fields with those names are ignored.
- **It validates the turn once.** The streaming and non-streaming routes share
  `buildTurnBody`, so `message` and `ui_state` are bounded identically. The SSE
  route used to forward `message` raw, turning a client mistake into a 502 from
  the agent rather than a 400.

### Timeouts are budgets, not constants

The server's ceiling must exceed the agent's own worst case
(`AI_QUEUE_TIMEOUT_S + AI_MODEL_TIMEOUT_S`, ~125s). It was 60s, so a merely slow
turn returned 503 while — because uvicorn does not cancel a non-streaming handler
on client disconnect — the graph kept running and kept billing the LLM. The
long-poll transport likewise derives from the requested wait; it was a flat 90s
against a 120s maximum, so 91..120s died at 90s instead of getting the agent's
own clean timeout.

`server.js` sets `requestTimeout`/`headersTimeout` to 0 so Node does not cut a
long wait; a reverse proxy in front must raise its own limits. `/api/ai/wait`
only works while the phone stays alive: see the background-wait notes in
`lib/agent/agent_spec/tables/human_in_the_loop.md` (Android foreground service,
iOS background mode + push).

Errors always carry a catalog `code` (`middlewares/errorCatalog.js`):
`VALIDATION`, `PRODUCT_NOT_FOUND`, `USER_NOT_FOUND`, `DB_UNAVAILABLE`, …

## Tests

```bash
npm test   # from the root; DB cases skip without DATABASE_URL
```

Sets `RATE_LIMIT=off` so the suite's own auth traffic does not trip the limits.
Supersedes the hand-maintained wiring map that used to live in this folder:
`./scripts/postman/validate.sh` now checks the API catalog against the routes,
and CI runs it.

## Which table backs what

Kept here because it is the one mapping nothing else holds: the endpoint list
above says what exists, this says where the data lives.

| Table | Endpoints |
|---|---|
| `users` | `POST /api/auth/*`, `GET/PATCH /api/users/me`, `GET /api/users/:id`, `GET /api/internal/users/:id` |
| `admins` | `POST /api/admin/login`, `POST/PATCH /api/admin/users*` — a separate id namespace from `users` |
| `seller_verifications` | `POST/GET /api/verifications*` (submit / me / list / review) |
| `products` | `/api/products*` (public + seller), `PATCH /:id/sold`, `/api/internal/products/*` |
| `product_events` | `POST /api/analytics/products/:id/event`; reads via the analytics endpoints |
| `conversations` + `messages` | `/api/conversations*` (open / inbox / room / send / history / wait / stream), `/api/internal/conversations/:id/messages` |
| `support_tickets` + `support_messages` | `/api/support/tickets*` |
| `reports` | `/api/reports*` (file / list / review + enforcement) |
| `notifications` + `notification_preferences` | `/api/notifications*` |
| `password_resets` | `POST /api/auth/forgot-password`, `/api/auth/reset-password` |
| `ai_conversations` + `ai_messages` | `GET /api/ai/conversations` (Prisma direct), `/api/ai/history/:id` (via the agent) |
| `ai_models` | `GET /api/models` + ADMIN CRUD |

The agent reaches the server only over HTTP on `/api/internal/*`, never the
database. Its side of the mapping lives in
`lib/agent/agent_spec/tables/tools.md`.

## Adding a new module

1. Create `routes/<name>.route.js` (paths + method wiring only, wrap handlers with `asyncHandler`).
2. Create `controllers/<name>.controller.js` (req/res handling only).
3. Register it in `routes/index.js`:
   `router.use('/<name>', require('./<name>.route'))`.
4. Keep controllers thin — extract a `services/` layer once business
   logic grows; document new files with NatSpec blocks.
5. Mirror new routes in `lib/server-monitoring/internal/api/api.go`
   `Registry()` so `kosmon list` and menu testing stay complete.
6. Add it to the Postman catalog (`postman/`) and run
   `./scripts/postman/validate.sh`. CI runs that check, so a route without a
   catalog entry fails the build — this replaces the old hand-maintained
   wiring map, which silently fell a release behind.
