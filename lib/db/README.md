# Kosply DB

MariaDB 11.4 and a small hand-written data layer. A `lib/`-level box next to
`server/` — `server/` stays thin and only reads `DATABASE_URL` from the env.

This folder owns the schema, the migration history, and the shared read shapes.
It is a library, not a running process: nothing here listens on a port.

## Stack

- MariaDB 11.4 (via the root `docker-compose.yml`)
- [`mysql2`](https://github.com/sidorares/node-mysql2) — the driver, nothing else
- Node >= 18

There is **no ORM**. The previous one was removed deliberately; see
[Why no ORM](#why-no-orm) below.

## Structure

```
lib/db/
  package.json              # own manifest: mysql2 + bcryptjs
  .env.example              # DATABASE_URL samples for dev/staging/main
  schema/migrations/        # committed SQL history — the schema
  schema/seed.js            # idempotent demo data, refuses production
  .db_spec/                 # per-table prose specs
  src/schema.js             # column registry: the app's view of the schema
  src/pool.js               # connection pool, globalThis-cached
  src/sql.js                # statement builder (where/orderBy/aggregate)
  src/cast.js               # MariaDB storage types -> the JS types the API promises
  src/db.js                 # statement runner + transactions
  src/errors.js             # driver error numbers -> stable codes
  src/ids.js                # cuid2 primary keys
  src/migrate.js            # migration runner
  src/drift.js              # migration history vs the column registry
  src/cli.js                # deploy / status / reset / validate
  src/selects.js            # the ONLY whitelisted read shapes
  src/testkit.js            # fixtures for database-backed tests
  src/repo/                 # the few reads that join (relations.js, …)
  docker/init.sh            # databases, grants, least-privilege agent role
  docker/checks.sql         # data-integrity constraints; run AFTER migrate
  tests/                    # SQL builder, coercion, selects, seed
```

## Run

Everything here has a wrapper; see the root `scripts/README.md`.

```bash
./scripts/db/db.sh install     # npm ci
./scripts/db/db.sh validate    # column registry is self-consistent (no database)
./scripts/db/db.sh migrate <name>  # create an empty migration file (LOCAL only)
./scripts/db/db.sh deploy      # apply pending migrations (use this everywhere)
./scripts/db/db.sh status      # what is applied, what is pending
./scripts/db/db.sh drift       # fail if migrations != column registry
./scripts/db/db.sh seed        # demo data
./scripts/db/db.sh reset       # DESTRUCTIVE: drop and re-apply
./scripts/db/db.sh testdb      # throwaway migrated database
```

Use `deploy`, never `migrate`, against staging or main.

## Why no ORM

Three properties of the old ORM stack were load-bearing and are now enforced by
this folder instead. Each one was a real bug before it was a rule:

1. **Booleans and JSON have to be coerced.** MariaDB has no `BOOLEAN` (it is
   `tinyint(1)`) and no `JSON` (it is `LONGTEXT` plus a `json_valid()` CHECK).
   The ORM handed the API `true`/`false` and parsed JSON; a raw driver hands
   back `0`/`1` and text. `src/cast.js` does that conversion, driven by
   `src/schema.js`. Without it the API serialised `"isActive": 1` and the
   Flutter client — which types the field as a bool — broke on every response
   carrying a user, product or admin.
2. **Column names must be checked before they reach the server.** Every table and
   column is declared in `src/schema.js`. The builder refuses an unknown one, so
   a typo fails at the call site with a clear message instead of
   `ER_BAD_FIELD_ERROR` at runtime. The same registry is what the drift gate
   compares against.
3. **Error codes must be classified, not passed through.** `src/errors.js` maps
   driver error *numbers* (`1062` duplicate, `1452` FK, `4025` check) and
   socket codes to stable `DB_*` codes, which `errorHandler.js` maps to the HTTP
   catalog. Without it every uniqueness race silently degrades to a 500.

### What the ORM gave us that this keeps

- `updatedAt` is refreshed on every write (`sql.js` appends
  `CURRENT_TIMESTAMP(3)`), because the column is `NOT NULL` with no default.
- `undefined` means "leave this column alone"; only `null` writes `NULL`. The
  builder drops `undefined` keys entirely.
- Writes re-read the row by primary key, so the caller gets what the database
  stored rather than what was sent.
- `id` columns absent from an insert are filled with a fresh cuid2.
- The comparison-and-set idiom (`updateMany` → affected rows) works because the
  pool sets `FOUND_ROWS`, so MariaDB reports rows *matched* rather than rows
  *changed*. `product.service.js` and `password.service.js` rely on this for
  their locks.

## The column registry is the schema's other half

`schema/migrations/*.sql` is what MariaDB ends up with. `src/schema.js` is what
the application believes it is talking to. `drift` checks they agree, in both
directions: a column the app reads but no migration creates is a latent
"column does not exist" in production, and a column a migration creates but the
registry omits is drift that later reads as an unexplained null.

```bash
./scripts/db/db.sh drift
```

## Migrations

A migration is one folder under `schema/migrations/` containing a
`migration.sql`, applied in name order. The ledger lives in
`_kosply_migrations` (name + SHA-256 of the file).

**A migration is not atomic and cannot be.** MariaDB implicitly commits before
and after every DDL statement, so wrapping a file in a transaction does not roll
it back: a file that creates five tables and fails on the sixth leaves five
tables behind. What the ledger does guarantee is that a failed migration records
no row, so the next run retries it rather than skipping it. The failure message
names the tables the file creates so they can be dropped first, which means
migrations must be written to be safe to re-run.

### Adoption

Because this project stopped maintaining the previous ORM's bookkeeping table,
the first `deploy` against a database that was already migrated finds a built
schema and an empty ledger. Adoption handles that: when the ledger is empty and
the database already holds tables, the runner compares that schema against the
column registry and records every migration as applied — but only if they agree
exactly. A database that does not agree is reported and left untouched. Set
`ADOPT=0` to disable it and fail instead.

## Why the JSON columns are `LONGTEXT`

MariaDB has no JSON type: `JSON` is an alias for `LONGTEXT` plus a
`json_valid()` CHECK constraint. The migrations declare `LONGTEXT` (with the
JSON-shaped `DEFAULT '[]'` where one applies), `checks.sql` re-adds
`JSON_VALID(...)`, and `cast.js` parses on read and stringifies on write. The
stored values are still JSON.

## Why `init.sh` is a shell script

The mariadb image runs every file in `docker-entrypoint-initdb.d` on first start
of an empty volume: `.sh` as a script, `.sql` through a bare client invocation
with no variable binding. Everything the bootstrap needs (staging/main/agent
databases, the app role's grants, and `kosply_agent` identified by
`AGENT_DB_PASSWORD`) is therefore interpolated inside `init.sh`.

## Why `checks.sql` exists

Grants and objects are per-database in MariaDB, so the file runs once per
database, after the migrations, wired into `scripts/server.sh` and `db.sh
deploy`. MariaDB has no `DO $$ … $$` blocks, so each guard is the plain-SQL
idiom: `SET @ddl := IF(<missing>, '<ALTER …>', 'SELECT 1'); PREPARE …; EXECUTE …;
DEALLOCATE …`.

## Models

- `users`: email unique, username unique, name, passwordHash (never plain!),
  universitas, programStudi, bio?, role `BUYER|SELLER|ADMIN|SUPER_ADMIN`,
  isActive, googleId?/appleId?
- `seller_verifications`: `userId` unique, namaLengkap (as printed on KTM),
  nim unique, universitas, programStudi, ktmImageUrl (private!),
  status `PENDING|APPROVED|REJECTED`, `isActive` (false = frozen),
  `action NONE|APPROVE|REJECT` + `actionNote`, `reviewedBy/reviewedAt`,
  `rejectionReason`
- `products`: sellerId FK users, title, description, price (Int rupiah), stock,
  imageUrls (JSON array, cover = [0]), category (seller-typed free text, not a
  taxonomy), location (latitude/longitude/locationLabel),
  status `ACTIVE|SOLD|ARCHIVED`, `soldAt?`
- `product_events`: one analytics event — `productId` FK (cascade),
  `type IMPRESSION|CLICK`, `viewerId?` (plain TEXT, **no FK** so deleting a
  viewer never erases the seller's history), `source`, `createdAt`. Append-only,
  never exposed publicly; sellers read aggregated counts via `/api/analytics`.
- `conversations`: COD room per product — `productId?` (SetNull keeps history),
  `buyerId`, `sellerId`, agreed COD point, `lastMessageAt`.
  Unique `[productId, buyerId]` = one room per buyer per product.
- `messages`: `conversationId`, `senderId`, `type TEXT|IMAGE|LOCATION|SYSTEM`,
  `text`, `imageUrl`, `latitude/longitude/locationLabel`, `isRead/readAt`.
- `support_tickets`: `ticketNo` unique (KSP-…), `userId` reporter,
  `category AKUN|PRODUK|CHAT|VERIFIKASI|LAPORAN|LAINNYA`, `status ACTIVE|CLOSED`,
  `subject`, `description`, `lastMessageAt`.
- `support_messages`: `ticketId`, `senderId?` (reporter or ADMIN), `text`,
  `imageUrl?`, `isInternal` (admin note, hidden from the reporter),
  `isRead/readAt`, and `senderRole`/`senderName` for platform-sent messages that
  have no user row.
- `reports`: `reportNo` unique (RPT-…), `reporterId`, `reportedUserId?`,
  `reportedProductId?`, `category`, `description`, `evidenceUrls`,
  `status PENDING|IN_REVIEW|RESOLVED|REJECTED`,
  `action NONE|WARNING|DELETE_PRODUCT|BAN_USER`, `reviewedBy/reviewedAt`.
- `admins`: dashboard account (email unique, passwordHash, isActive) — a
  **separate id namespace** from `users`.
- `password_resets`: 4-digit OTP rows (`codeHash`, `expiresAt`, `attempts`,
  `consumedAt`).
- `ai_conversations` / `ai_messages`: resumable AI sessions (`thread_id` = row
  id); `ai_messages.model` matches `ai_models.modelId`.
- `ai_models`: registry (`modelId` unique, pricing USD per 1M tokens, `isActive`).
- `notifications` + `notification_preferences`: personal inbox and free toggles.
- `tool_invocations`: append-only AI tool-call log for the ops benchmark
  (`userId` plain TEXT, **no FK**, for the same reason as `product_events`).
- `refresh_tokens`: the state that makes a session revocable. `subjectType`
  (`user` / `staff` / `admin`) + `subjectId` replace a FK because the id
  namespaces are disjoint; `tokenHash` is an HMAC-SHA256, never the token;
  `familyId` groups a rotation chain so a replay can be detected; `consumedAt`
  (rotated away) and `revokedAt` (ended on purpose) are separate columns so an
  ordinary logout does not look like theft.

### `reviewedBy` is deliberately not a foreign key

On `seller_verifications` and `reports`, `reviewedBy` is a plain TEXT audit
field. The deciding admin is often an `admins` (dashboard) row, whose id
namespace is disjoint from `users`. Enforcing a `users` foreign key made the
entire review path fail with a foreign-key error, so the review transaction could
never complete.

## `refresh_tokens` and why it has no foreign key

The access token is a stateless JWT, so on its own there is no way to end a
session: clearing a cookie on one machine leaves the bearer token usable
everywhere until it expires. These rows are that missing state.

- **No FK, on purpose.** A subject is an `admins` row or a `users` row, and the
  two id namespaces are disjoint. A `users` FK would have made refresh impossible
  for exactly half the accounts that sign in through `/api/admin/login` — the
  same reason `seller_verifications.reviewedBy` carries none.
- **`tokenHash` is `char(64)`.** `HMAC-SHA256(REFRESH_TOKEN_SECRET, token)`. The
  key lives in the environment, not next to the rows, so a database dump yields
  no usable credential.
- **`consumedAt` and `revokedAt` are different columns.** Rotation sets
  `consumedAt`; logout and reuse detection set `revokedAt`. Collapsing them would
  make every ordinary logout indistinguishable from a stolen token, and would
  tear down every other session the account has open.
- **Housekeeping is opportunistic.** `refresh.service.js` sweeps a subject's
  long-expired rows whenever it issues a token. A `CREATE EVENT` would need the
  `EVENT` privilege and `event_scheduler=ON`, which is off by default, so putting
  one in a migration would fail on a stock server.

## Rules

- Seller capability = an APPROVED **and** `isActive` verification. `role` alone
  is not sufficient: a rejected or frozen seller must not be able to list.
- `ktmImageUrl` never leaves via `/api/products` — admin verification endpoints
  only.
- `price >= 0`, `stock >= 0`, latitude/longitude in range,
  `password_resets.attempts >= 0` and JSON validity of the three JSON columns
  are enforced by `docker/checks.sql` as well as in the service layer. The
  database is the last line of defence: a future writer is not the service layer.
- Separate database per environment: `kosply_dev` (local), `kosply_staging`
  (:3001), `kosply_main` (:3000). `kosply_agent` holds only the agent's
  checkpointer and history mirror, under its own least-privilege role.

## Security (leak prevention + liveness)

- `src/selects.js` holds the only whitelisted column lists; services import them
  instead of naming columns by hand, so email, passwordHash, nim or the KTM URL
  cannot leak through a new endpoint by accident.
- `tests/selects.test.js` fails the suite if a sensitive column appears in a
  public shape.
- `lib/server/config/db.js` degrades to `503 DB_UNAVAILABLE` instead of crashing
  boot when the driver or `DATABASE_URL` is missing.
- The pool runs with `multipleStatements` **off**. Runtime queries are single
  statements; stacking them would turn any injection point into a data leak. Only
  the migration runner opens a connection with it enabled.
- Idle pooled sockets are `unref`ed, so a finished script or a test run exits
  instead of hanging on a live handle.
- The seed is idempotent (upserts) and refuses a production-like database. Hashes
  it writes are markers, not credentials.