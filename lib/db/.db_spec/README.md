# Kosply DB Spec

Source: `lib/db/prisma/schema.prisma` (Postgres 16 + Prisma 6). Status: **implemented** — every table below exists in the schema and passes `prisma validate + generate`.

## Table list

| Table | Spec file | Purpose |
|---|---|---|
| `users` | `tables/users.md` | Buyer / seller / admin accounts |
| `seller_verifications` | `tables/seller_verifications.md` | Student ID/KTM verification + approval |
| `products` | `tables/products.md` | Second-hand catalog |
| `conversations` | `tables/conversations.md` | COD chat room per product |
| `messages` | `tables/messages.md` | Chat bubbles (text/image/location) |
| `support_tickets` | `tables/support_tickets.md` | Support help tickets |
| `support_messages` | `tables/support_messages.md` | Support chat + internal notes |
| `reports` | `tables/reports.md` | Catalog fraud reports |
| `admins` | `tables/admins.md` | Dashboard admin accounts (email + password) |
| `password_resets` | `tables/password_resets.md` | 4-digit OTP password change via email |
| `ai_conversations` | `tables/ai_conversations.md` | AI chat sessions (titled, resumable) |
| `ai_messages` | `tables/ai_messages.md` | AI chat messages (user / assistant / system) |
| `ai_models` | `tables/ai_models.md` | AI model registry (pricing in USD, enable/disable) |

## Enums

- `UserRole`: `BUYER | SELLER | ADMIN`
- `VerificationStatus`: `PENDING | APPROVED | REJECTED`
- `VerificationAction`: `NONE | APPROVE | REJECT`
- `ProductStatus`: `ACTIVE | SOLD | ARCHIVED`
- `MessageType`: `TEXT | IMAGE | LOCATION | SYSTEM`
- `SupportTicketStatus`: `ACTIVE | CLOSED`
- `SupportTicketCategory`: `AKUN | PRODUK | CHAT | VERIFIKASI | LAPORAN | LAINNYA`
- `ReportCategory`: `PENIPUAN | BARANG_PALSU | BARANG_TIDAK_SESUAI | HARGA_MENYESATKAN | KONTEN_TIDAK_PANTAS | SPAM | LAINNYA`
- `ReportStatus`: `PENDING | IN_REVIEW | RESOLVED | REJECTED`
- `ReportAction`: `NONE | WARNING | DELETE_PRODUCT | BAN_USER`
- `AiMessageRole`: `USER | ASSISTANT | SYSTEM`

## Table relations

```
users 1--0..1 seller_verifications
users 1--N products (as seller)
users 1--N conversations (as buyer / as seller)
conversations 1--N messages
products 1--N conversations (nullable, SetNull)
users 1--N support_tickets (as reporter)
support_tickets 1--N support_messages
users 1--N reports (as reporter / reportedUser / reviewedBy)
products 1--N reports (nullable, SetNull)
users 1--N seller_verifications (as reviewedBy admin)
admins (standalone — dashboard session, no relations to other tables)
users 1--N password_resets (OTP tickets per user)
users 1--N ai_conversations (AI chat sessions per user)
ai_conversations 1--N ai_messages
ai_models (standalone — referenced by `ai_messages.model` string, no FK)
```

## Display numbers (human-readable)

| Table | Field | Format | Generated in |
|---|---|---|---|
| `support_tickets` | `ticketNo` unique | `KSP-YYYYMMDD-XXXX` | service |
| `reports` | `reportNo` unique | `RPT-YYYYMMDD-XXXX` | service |

## Global rules

1. Store passwords as `passwordHash`, never plain text.
2. `ktmImageUrl` is private — admin only, never include it in public product/chat responses.
3. Product `category` is still `String?` (blank) — TODO: become a `Category` FK.
4. Separate DB per env: `kosply_dev` / `kosply_staging` / `kosply_main`.
5. `price >= 0`, `stock >= 0` are validated in the service/zod layer.
