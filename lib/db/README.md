# Kosply DB

Postgres + Prisma. A `lib/`-level box next to `server/` — `server/` stays thin
and only reads `DATABASE_URL` from the env.

## Stack
- Postgres 16 (via root `docker-compose.yml`)
- Prisma 6 (`prisma/schema.prisma` + `@prisma/client`)
- Node >= 18

## Structure
```
lib/db/
  package.json          # own manifest: @prisma/client + prisma
  .env.example          # DATABASE_URL samples for dev/staging/main
  prisma/schema.prisma  # models + enums (English NatSpec)
  prisma/migrations/    # committed migration history
  .db_spec/             # per-table specs (English, mirrors the schema)
  src/client.js         # PrismaClient singleton
  docker/init.sql       # create staging + main DBs
```

## Run
```bash
# 1. Start Postgres (from root)
docker compose up -d postgres

# 2. Install + generate (from lib/db)
cd lib/db
npm install
npx prisma generate

# 3. Dev migration
npx prisma migrate dev --name init

# Studio
npx prisma studio
```

## Models
- `User`: email unique, username unique, name, passwordHash (never plain!), universitas, programStudi, bio?, role `BUYER|SELLER|ADMIN`.
- `SellerVerification`: `userId unique`, namaLengkap (as printed on KTM), nim unique, universitas, programStudi, ktmImageUrl (private!), status `PENDING|APPROVED|REJECTED`, `isActive` (false = frozen), `action NONE|APPROVE|REJECT` + `actionNote`, `reviewedBy/reviewedAt`.
- `Product`: sellerId FK User, title, description (@db.Text), price Int rupiah, stock Int (quantities), imageUrls String[] (cover = [0]), category String? (blank for now, TODO FK), location (latitude/longitude/locationLabel), status `ACTIVE|SOLD|ARCHIVED`, `soldAt?` (stamped on mark-sold so sales bucket by date).
- `ProductEvent`: one analytics event for the seller dashboard — `productId` FK (cascade), `type IMPRESSION|CLICK`, `viewerId?` (plain TEXT, **no FK** so deleting a viewer never erases the seller's history), `source` (`feed|search|share|detail|unknown`), `createdAt`. Append-only, never exposed publicly; sellers read aggregated counts via `/api/analytics`.
- `Conversation`: COD room per product — `productId?` (SetNull keeps history), `buyerId`, `sellerId`, agreed COD point, `lastMessageAt`. Unique `[productId, buyerId]` = 1 buyer x 1 product = 1 room.
- `Message`: `conversationId`, `senderId`, `type TEXT|IMAGE|LOCATION|SYSTEM`, `text` (TEXT), `imageUrl` (IMAGE), `latitude/longitude/locationLabel` (LOCATION), `isRead/readAt`.
- `SupportTicket`: `ticketNo unique` (display, e.g. KSP-...), `userId` reporter (name/username via join, no duplication), `category AKUN|PRODUK|CHAT|VERIFIKASI|LAPORAN|LAINNYA`, `status ACTIVE|CLOSED`, `subject`, `description`, `lastMessageAt`.
- `SupportMessage`: `ticketId`, `senderId` (reporter or ADMIN), `text`, `imageUrl?`, `isInternal` (admin note, hidden from reporter), `isRead/readAt`.
- `Report`: `reportNo unique` (display, e.g. RPT-...), `reporterId`, `reportedUserId?` (fraud/reported), `reportedProductId?` (listing), `category PENIPUAN|BARANG_PALSU|...|LAINNYA`, `description`, `evidenceUrls[]`, `status PENDING|IN_REVIEW|RESOLVED|REJECTED`, `action NONE|WARNING|DELETE_PRODUCT|BAN_USER`, `reviewedBy/reviewedAt`.
- `Admin`: dashboard account (email unique, passwordHash, isActive), separate from `users`.
- `PasswordReset`: 4-digit OTP rows (`codeHash`, `expiresAt`, `attempts`, `consumedAt`).
- `AiConversation` / `AiMessage`: resumable AI sessions (`thread_id` = row id); `AiMessage.model` matches `AiModel.modelId`.
- `AiModel`: registry (`modelId unique`, pricing USD per 1M tokens, `isActive`).

## Rules
- Seller = `User.role == SELLER` (promoted after APPROVED verification).
- `ktmImageUrl` never leaves via `/api/products` — admin verification endpoint only.
- `price >= 0`, `stock >= 0` validated in service/zod later (DB stores plain Int).
- Separate DB per env: `kosply_dev` (local), `kosply_staging` (:3001), `kosply_main` (:3000).

## Security (leak prevention + liveness)
- `src/selects.js` holds the only whitelisted field sets; controllers import
  them instead of hand-writing `select` (email, passwordHash, nim, KTM can
  never leak through a new endpoint by accident).
- `tests/selects.test.js` fails the suite if a sensitive column appears.
- `config/db.js` (server side) degrades to `503 DB_UNAVAILABLE` instead of
  crashing boot when the client or `DATABASE_URL` is missing.
- Seed is idempotent (upserts) and DEV ONLY — hashes are markers, not credentials.
