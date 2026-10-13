# Kosply DB

MariaDB + Prisma. A `lib/`-level box next to `server/` — `server/` stays thin
and only reads `DATABASE_URL` from the env.

This folder owns the schema, the migration history, and the shared read shapes.
It is a library, not a running process: nothing here listens on a port.

## Stack

- MariaDB 11.4 (via the root `docker-compose.yml`)
- Prisma 6 (`schema/schema.db` + `@prisma/client`)
- Node >= 18

## Structure

```
lib/db/
  package.json              # own manifest: @prisma/client + prisma
  .env.example              # DATABASE_URL samples for dev/staging/main
  schema/schema.db          # models + enums (English NatSpec)
  schema/migrations/        # committed history — the source of truth
  schema/seed.js            # idempotent demo data, refuses production
  .db_spec/                 # per-table specs (English, mirrors the schema)
  src/client.js             # PrismaClient singleton
  src/selects.js            # the ONLY whitelisted read shapes
  docker/init.sh            # databases, grants, least-privilege agent role
  docker/checks.sql         # data-integrity constraints; run AFTER migrate
  tests/                    # seed + selects tests
```

## Run

Everything here has a wrapper; see the root `scripts/README.md`.

```bash
./scripts/db/db.sh install     # npm ci + prisma generate
./scripts/db/db.sh validate    # static schema check, no database needed
./scripts/db/db.sh migrate <name>  # create + apply a migration (LOCAL only)
./scripts/db/db.sh deploy      # apply pending migrations (use this everywhere)
./scripts/db/db.sh drift       # fail if migrations != schema.db
./scripts/db/db.sh seed        # demo data
./scripts/db/db.sh studio      # Prisma Studio
./scripts/db/db.sh testdb      # throwaway migrated database
```

Use `deploy`, never `migrate`, against staging or main: creating a migration can
decide the schema drifted and **reset the database**, which there is data loss.

`migrate <name>` and `drift` both go through `scripts/db/schema-diff.sh`, which
replays the committed migrations into the `kosply_shadow` database
(`docker/init.sh` provisions it) and diffs the result against `schema/schema.db`.

### Why the `Json` columns are `LONGTEXT` in the migrations

MariaDB has no JSON type: `JSON` is an alias for `LONGTEXT` plus a
`json_valid()` CHECK constraint, and Prisma introspects the result as
`String @db.LongText`. Writing `JSON` in the migration therefore left the
datamodel (`Json`) permanently disagreeing with the database, so every diff
reported the three columns as "type changed" and would have generated endless
`MODIFY COLUMN ... JSON NOT NULL` migrations. The migrations declare `LONGTEXT`
(with the JSON-shaped `DEFAULT '[]'` where the schema declares one), `checks.sql`
re-adds `JSON_VALID(...)`, and `schema-diff.sh` normalises the datamodel's `Json`
scalars before diffing. The stored values are still JSON and the Prisma Client
still does the encode/decode.

### Why `init.sh` is a shell script

The mariadb image runs every file in `docker-entrypoint-initdb.d` on first start
of an empty volume: `.sh` as a script, `.sql` through a bare client invocation
with no variable binding. Everything the bootstrap needs (staging/main/agent
databases, the app role's grants, and `kosply_agent` identified by
`AGENT_DB_PASSWORD`) is therefore interpolated inside `init.sh` — a separate
`.sql` would either run twice or run with a password that disagreed with the
agent's DSN.

### Why `checks.sql` exists

Cross-database DDL is not a thing in MariaDB either — grants and objects are
per-database, so the file runs once per database, after `migrate`, wired into
`scripts/server.sh` and `db.sh deploy`. MariaDB has no `DO $$ ... $$` blocks
(those are plpgsql) and `prisma db execute` has no DELIMITER handling, so each
guard is the plain-SQL idiom: `SET @ddl := IF(<missing>, '<ALTER ...>',
'SELECT 1'); PREPARE ...; EXECUTE ...; DEALLOCATE ...`.

## Models

- `User`: email unique, username unique, name, passwordHash (never plain!),
  universitas, programStudi, bio?, role `BUYER|SELLER|ADMIN|SUPER_ADMIN`,
  isActive, photoUrl?
- `SellerVerification`: `userId unique`, namaLengkap (as printed on KTM),
  nim unique, universitas, programStudi, ktmImageUrl (private!),
  status `PENDING|APPROVED|REJECTED`, `isActive` (false = frozen),
  `action NONE|APPROVE|REJECT` + `actionNote`, `reviewedBy/reviewedAt`,
  `rejectionReason`
- `Product`: sellerId FK User, title, description (@db.Text), price Int rupiah,
  stock Int, imageUrls String[] (cover = [0]), category String? (seller-typed
  free text, not a taxonomy), location (latitude/longitude/locationLabel),
  status `ACTIVE|SOLD|ARCHIVED`, `soldAt?`
- `ProductEvent`: one analytics event — `productId` FK (cascade),
  `type IMPRESSION|CLICK`, `viewerId?` (plain TEXT, **no FK** so deleting a
  viewer never erases the seller's history), `source`
  (`feed|search|share|detail|unknown`), `createdAt`. Append-only, never exposed
  publicly; sellers read aggregated counts via `/api/analytics`.
- `Conversation`: COD room per product — `productId?` (SetNull keeps history),
  `buyerId`, `sellerId`, agreed COD point, `lastMessageAt`.
  Unique `[productId, buyerId]` = one room per buyer per product.
- `Message`: `conversationId`, `senderId`, `type TEXT|IMAGE|LOCATION|SYSTEM`,
  `text`, `imageUrl`, `latitude/longitude/locationLabel`, `isRead/readAt`.
- `SupportTicket`: `ticketNo unique` (KSP-…), `userId` reporter, `category
  AKUN|PRODUK|CHAT|VERIFIKASI|LAPORAN|LAINNYA`, `status ACTIVE|CLOSED`,
  `subject`, `description`, `lastMessageAt`.
- `SupportMessage`: `ticketId`, `senderId` (reporter or ADMIN), `text`,
  `imageUrl?`, `isInternal` (admin note, hidden from the reporter),
  `isRead/readAt`, and `senderRole`/`senderName` for platform-sent messages
  that have no user row.
- `Report`: `reportNo unique` (RPT-…), `reporterId`, `reportedUserId?`,
  `reportedProductId?`, `category`, `description`, `evidenceUrls[]`,
  `status PENDING|IN_REVIEW|RESOLVED|REJECTED`,
  `action NONE|WARNING|DELETE_PRODUCT|BAN_USER`, `reviewedBy/reviewedAt`.
- `Admin`: dashboard account (email unique, passwordHash, isActive) — a
  **separate id namespace** from `users`.
- `PasswordReset`: 4-digit OTP rows (`codeHash`, `expiresAt`, `attempts`,
  `consumedAt`).
- `AiConversation` / `AiMessage`: resumable AI sessions (`thread_id` = row id);
  `AiMessage.model` matches `AiModel.modelId`.
- `AiModel`: registry (`modelId unique`, pricing USD per 1M tokens, `isActive`).
- `Notification` + `NotificationPreference`: personal inbox and free toggles.

### `reviewedBy` is deliberately not a foreign key

On `SellerVerification` and `Report`, `reviewedBy` is a plain TEXT audit field.
The deciding admin is often an `admins` (dashboard) row, whose id namespace is
disjoint from `users`. Enforcing a `users` foreign key made the entire review
path fail with P2003, so the review transaction could never complete.

## Rules

- Seller capability = an APPROVED **and** `isActive` verification. `role` alone
  is not sufficient: a rejected or frozen seller must not be able to list.
- `ktmImageUrl` never leaves via `/api/products` — admin verification endpoints
  only.
- `price >= 0`, `stock >= 0`, latitude/longitude in range,
  `password_resets.attempts >= 0` and JSON validity of the three `Json` columns
  are enforced by `docker/checks.sql` as well as in the service layer. The
  database is the last line of defence: Prisma Studio and any future writer are
  not the service layer.
- Separate database per environment: `kosply_dev` (local),
  `kosply_staging` (:3001), `kosply_main` (:3000). `kosply_agent` holds only
  the agent's checkpointer and history mirror, under its own least-privilege
  role.

## Security (leak prevention + liveness)

- `src/selects.js` holds the only whitelisted field sets; controllers import
  them instead of hand-writing `select`, so email, passwordHash, nim or the KTM
  URL cannot leak through a new endpoint by accident.
- `tests/selects.test.js` fails the suite if a sensitive column appears in a
  public shape.
- `lib/server/config/db.js` degrades to `503 DB_UNAVAILABLE` instead of crashing
  boot when the client or `DATABASE_URL` is missing.
- The seed is idempotent (upserts) and refuses a production-like database.
  Hashes it writes are markers, not credentials.