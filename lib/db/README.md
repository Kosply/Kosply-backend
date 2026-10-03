# Kosply DB

Postgres + Prisma. A `lib/`-level box next to `server/` — `server/` stays thin
and only reads `DATABASE_URL` from the env.

This folder owns the schema, the migration history, and the shared read shapes.
It is a library, not a running process: nothing here listens on a port.

## Stack

- Postgres 16 (via the root `docker-compose.yml`)
- Prisma 6 (`prisma/schema.prisma` + `@prisma/client`)
- Node >= 18

## Structure

```
lib/db/
  package.json              # own manifest: @prisma/client + prisma
  .env.example              # DATABASE_URL samples for dev/staging/main
  prisma/schema.prisma      # models + enums (English NatSpec)
  prisma/migrations/        # committed history — the source of truth
  prisma/seed.js            # idempotent demo data, refuses production
  .db_spec/                 # per-table specs (English, mirrors the schema)
  src/client.js             # PrismaClient singleton
  src/selects.js            # the ONLY whitelisted read shapes
  docker/init.sh            # cluster bootstrap wrapper (passes psql vars)
  docker/init.sql           # databases, extensions, least-privilege agent role
  docker/checks.sql         # data-integrity constraints; run AFTER migrate
  tests/                    # seed + selects tests
```

## Run

Everything here has a wrapper; see the root `scripts/README.md`.

```bash
./scripts/db/db.sh install     # npm ci + prisma generate
./scripts/db/db.sh validate    # static schema check, no database needed
./scripts/db/db.sh deploy      # apply pending migrations (use this everywhere)
./scripts/db/db.sh drift       # fail if migrations != schema.prisma
./scripts/db/db.sh seed        # demo data
./scripts/db/db.sh studio      # Prisma Studio
./scripts/db/db.sh testdb      # throwaway migrated database
```

Use `deploy`, never `migrate`, against staging or main: `prisma migrate dev` can
decide the schema drifted and **reset the database**, which there is data loss.

### Why `init.sh` exists

The postgres image runs every `.sql` in `docker-entrypoint-initdb.d` itself,
with a bare `psql -f` and no variables. `init.sql` needs
`-v agent_password=...` so the `kosply_agent` role matches the agent's
`AGENT_DB_PASSWORD`; without it the role silently disagreed with the DSN and the
agent crash-looped. So only the shell wrapper lives in that directory, and it
points at `init.sql` mounted elsewhere. Keeping both there made the image run
the SQL twice, the second time without the variable.

### Why `checks.sql` exists

Cross-database DDL is not a thing in Postgres. An earlier attempt looped over
database names with `format('ALTER TABLE %I.products ...')`, and `%I` quotes an
*identifier*, so it produced `ALTER TABLE kosply_main.products` — rejected with
`schema "kosply_main" does not exist`. The constraints silently never existed.
They now live in a separate idempotent file that runs once per database, after
`migrate`, wired into `scripts/server.sh` and `db.sh deploy`.

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
- `price >= 0`, `stock >= 0`, latitude/longitude in range, and
  `password_resets.attempts >= 0` are enforced by `docker/checks.sql` as well as
  in the service layer. The database is the last line of defence: `psql`,
  Prisma Studio and any future writer are not the service layer.
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