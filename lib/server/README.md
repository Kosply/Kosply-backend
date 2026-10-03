# Kosply Server

Express API powering Kosply. Lives in `lib/server/` so `lib/` can later
hold sibling runtimes (`lib/agent/` for Python, `lib/shared/`, etc.)
without refactoring the project root.

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
  middlewares/auth/     # JWT authenticate + requireRole
  middlewares/errorCatalog.js  # error codes (add codes here, never inline)
  tests/<domain>/       # node:test suites, no deps (`npm test`)
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

| Key | Local | Staging (PM2) | Main (PM2) |
|---|---|---|---|
| `NODE_ENV` | `development` | `staging` | `production` |
| `PORT` | `3000` | `3001` | `3000` |
| `CORS_ORIGIN` | `*` | `*` | `*` (set the real domain on go-live) |

Resolution order: PM2 `env` → `.env` file → defaults in `config/env.js`
(dotenv never overrides existing variables, so PM2 always wins).
`PORT` is strictly validated (digits only, 1-65535); `CORS_ORIGIN` lists are
trimmed; `app.js` sets `trust proxy: 1` with `1mb` body limits.

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
`Conversation` + buyer `Message` rows, sales from `Product.status = SOLD`.
Only impressions/clicks need a new table (`ProductEvent`).

There is deliberately **no** platform revenue/profit math — Kosply is COD and
money moves off-platform, so `salesValue` is the seller's own gross only.

POC limits, revisit before production:
- The ingest dedupe window is in-process (`Map` + TTL), so it resets on
  restart and is per-PM2-worker. The server has no `express-rate-limit`
  anywhere, so a real deployment needs a shared limiter (Redis) or a DB-side
  unique key before anonymous ingest is trustworthy.
- Feed/search surfaces are **not** auto-instrumented. Implicit writes on
  anonymous routes are a free amplification vector; the client fires events
  explicitly instead.
- `sellerOverview` caps at 500 products per seller (`VALIDATION` beyond).

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
email-only. Set a strong `JWT_SECRET` outside local dev.

## AI proxy (single backend for Flutter)

- `POST /api/ai/chat` → one turn (JWT identity forwarded, never body identity)
- `POST /api/ai/chat/stream` → SSE piped from the agent
- `POST /api/ai/chat/resume` → approve/reject passthrough
- `GET /api/ai/wait/:id?timeout=N` → long-poll a pending approval (1..1500 s)
- `GET /api/ai/conversations` → own session list (Flutter history list)
- `GET /api/ai/history/:id` → history passthrough

Needs `AI_AGENT_URL` (default `http://localhost:8000`); agent down gives
`503 AGENT_UNAVAILABLE` while everything else keeps serving.

`server.js` sets `requestTimeout`/`headersTimeout` to 0 so Node does not cut a
long wait; a reverse proxy in front must raise its own limits. `/api/ai/wait`
only works while the phone stays alive: see the background-wait notes in
`lib/agent/agent_spec/tables/human_in_the_loop.md` (Android foreground service,
iOS background mode + push).

Errors always carry a catalog `code` (`middlewares/errorCatalog.js`):
`VALIDATION`, `PRODUCT_NOT_FOUND`, `USER_NOT_FOUND`, `DB_UNAVAILABLE`, …

## Tests

```bash
npm test   # node:test, no deps; DB cases skip without DATABASE_URL
```

## Adding a new module

1. Create `routes/<name>.route.js` (paths + method wiring only, wrap handlers with `asyncHandler`).
2. Create `controllers/<name>.controller.js` (req/res handling only).
3. Register it in `routes/index.js`:
   `router.use('/<name>', require('./<name>.route'))`.
4. Keep controllers thin — extract a `services/` layer once business
   logic grows; document new files with NatSpec blocks.
5. Mirror new routes in `lib/server-monitoring/internal/api/api.go`
   `Registry()` so `kosmon list` and menu testing stay complete.
