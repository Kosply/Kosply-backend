# seed/ — dashboard demo fixtures

One command fills a development database with everything the admin dashboard
renders, so no page is empty during a demo. **Dev only**: the guard
(`guard.js`) refuses `NODE_ENV=production` and any database that is not
`kosply_dev`, `kosply_test` or `test`.

## Run

```bash
./seed.sh                 # operator account + all dashboard fixtures
./seed.sh accounts        # only the login-able operator account
./seed.sh dashboard       # only the fixtures (no account)
```

The script ships with **placeholders on purpose** — a committed file must never
carry real credentials. Put your own values in `.env` (gitignored) or pass them
inline (an exported variable wins over the file, matching dotenv semantics):

```env
# .env
SEED_ADMIN_EMAIL="you@example.com"
SEED_ADMIN_PASSWORD="ChangeMe-123456"   # leave empty to generate + print one
SEED_ADMIN_NAME="Ops Super Admin"
```

```bash
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='…' ./seed.sh
```

Re-running is safe: every row upserts on a stable key (email, `userId`,
`reportNo`, `ticketNo`, `modelId` or an explicit `seed-*` id) and the relative
timestamps are refreshed, so the queues stay recent instead of aging out.

## What it seeds (per dashboard surface)

| Fixture | Rows | Dashboard surface |
|---|---|---|
| `accounts.js` | 1 operator — SUPER_ADMIN in `users` + a matching `admins` row | `/login`, top bar, `/settings` |
| `dashboard.js` users + products | 11 users, 7 products | the names/ids that back every queue row |
| verifications | 7 — 3 PENDING, 3 APPROVED, 1 REJECTED (plus one frozen after a ban) | `/user-verification`, dashboard KPI |
| reports | 10 — 4 PENDING, 2 IN_REVIEW, 3 RESOLVED, 1 REJECTED (all four actions) | `/fraud-reports`, dashboard queue |
| support tickets | 8 tickets (4 ACTIVE, 4 CLOSED) + 22 messages incl. internal notes | `/contact-support`, `/contact-support/[id]` |
| AI models | 6 registry rows, one disabled | `/ai-model`, dashboard KPI |
| tool invocations | 120 rows — 6 tools × 6 models, SUCCESS/FAILED/TIMEOUT mix, latency bands, evening-weighted hours | tools benchmark (`GET /api/tools/stats`) |

Deliberately **not** seeded: chat conversations/messages, notifications,
analytics events and AI conversations — they have no dashboard surface yet.

## Design rules

- **Placeholders, never credentials.** `seed.sh` and `.env.example` carry
  placeholders; real values live in `.env` only (gitignored).
- **Marketplace rows are not login-able.** Their passwords are SHA-256 markers
  (same rule as `lib/db/schema/seed.js`); only the operator account gets a
  bcrypt hash so it can actually sign in to the dashboard.
- **Cross-story fixtures.** The RESOLVED `DELETE_PRODUCT` report points at the
  ARCHIVED product, and the RESOLVED `BAN_USER` report belongs to the frozen
  seller whose verification is `isActive: false` — the trail a real moderation
  flow leaves behind, so the dashboard reads like a live system.
- **Dashboard-shape messages.** One support reply uses `senderId: null` +
  `senderName`, which is exactly what `support.service.reply` writes when the
  operator answered from a dashboard session (no `users` row exists for it).
- **Freshness matters.** PENDING rows carry the newest timestamps and several
  tickets are dated *today*, so the KPI tiles and "Open Today / Closed Today"
  counters are non-zero.
- **Tool invocations are a log.** That one table is rebuilt instead of upserted:
  the seed deletes its own `seed-tool-*` rows and re-inserts `TOOL_PLAN`, so the
  benchmark numbers always match the plan and never accumulate stale rows.
