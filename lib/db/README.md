# Kosply DB

Postgres + Prisma. Kotak level `lib/` sejajar dengan `server/` — `server/` tetap tipis, cuma baca `DATABASE_URL` dari env.

## Stack
- Postgres 16 (via root `docker-compose.yml`)
- Prisma 6 (`prisma/schema.prisma` + `@prisma/client`)
- Node >= 18

## Structure
```
lib/db/
  package.json          # manifest sendiri: @prisma/client + prisma
  .env.example          # contoh DATABASE_URL dev/staging/main
  prisma/schema.prisma  # User, SellerVerification, Product + enums
  .db_spec/             # spec tabel (cerminan schema, per tabel)
  src/client.js         # singleton PrismaClient
  docker/init.sql       # create DB staging + main
```

## Run
```bash
# 1. Naikkan Postgres (dari root)
docker compose up -d postgres

# 2. Install + generate (dari lib/db)
cd lib/db
npm install
npx prisma generate

# 3. Migrasi dev
npx prisma migrate dev --name init

# Studio
npx prisma studio
```

## Models
- `User`: email unique, username unique, name, passwordHash (jangan plain!), universitas, programStudi, role `BUYER|SELLER|ADMIN`.
- `SellerVerification`: `userId unique`, namaLengkap (sesuai KTM), nim unique, universitas, programStudi, ktmImageUrl (private!), status `PENDING|APPROVED|REJECTED`, `isActive` (aktif/non-aktif, false = dibekukan), `action NONE|APPROVE|REJECT` + `actionNote`, `reviewedBy/reviewedAt`.
- `Product`: sellerId FK User, title, description (@db.Text), price Int rupiah, stock Int (quantities), imageUrls String[] (cover = [0]), category String? (blank dulu, TODO FK), status `ACTIVE|SOLD|ARCHIVED`.
- `Conversation`: room COD per produk — `productId?` (SetNull biar history awet), `buyerId`, `sellerId`, `lastMessageAt`. Unique `[productId, buyerId]` = 1 buyer x 1 produk = 1 room.
- `Message`: `conversationId`, `senderId`, `type TEXT|IMAGE|LOCATION|SYSTEM`, `text` (TEXT), `imageUrl` (IMAGE), `latitude/longitude/locationLabel` (LOCATION), `isRead/readAt`.
- `SupportTicket`: `ticketNo unique` (tampil, mis. KSP-...), `userId` pelapor (nama/username via join, tanpa duplikasi), `category AKUN|PRODUK|CHAT|VERIFIKASI|LAPORAN|LAINNYA`, `status ACTIVE|CLOSED`, `subject`, `description`, `lastMessageAt`.
- `SupportMessage`: `ticketId`, `senderId` (pelapor atau ADMIN), `text`, `imageUrl?`, `isInternal` (catatan admin, sembunyikan dari user), `isRead/readAt`.
- `Report`: `reportNo unique` (tampil, mis. RPT-...), `reporterId` pelapor, `reportedUserId?` (fraud/terlapor), `reportedProductId?` (postingan), `category PENIPUAN|BARANG_PALSU|...|LAINNYA`, `description`, `evidenceUrls[]`, `status PENDING|IN_REVIEW|RESOLVED|REJECTED`, `action NONE|WARNING|DELETE_PRODUCT|BAN_USER`, `reviewedBy/reviewedAt`.

## Rules
- Seller = `User.role == SELLER` (dipromosikan setelah verifikasi APPROVED).
- `ktmImageUrl` jangan pernah ikut response `/api/products` — hanya admin via endpoint verifikasi.
- Validasi `price >= 0`, `stock >= 0` di service/zod nanti (DB simpan Int polos).
- Tiap env DB terpisah: `kosply_dev` (local), `kosply_staging` (:3001), `kosply_main` (:3000).
