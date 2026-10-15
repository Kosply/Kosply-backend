# seller_verifications — implemented

Student ID (KTM) verification. One row per user; `APPROVED` + `isActive` is what actually grants selling capability, not `users.role`.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `userId` | varchar(191) | FK (user → users.id) |  |
| `namaLengkap` | varchar(191) |  |  |
| `nim` | varchar(191) |  | unique across the platform |
| `universitas` | varchar(191) |  |  |
| `programStudi` | varchar(191) |  |  |
| `ktmImageUrl` | varchar(191) |  | **private** — admin only, never public |
| `status` | enum |  | decided by an admin |
| `isActive` | tinyint(1) |  | false = frozen, cannot sell |
| `action` | enum |  |  |
| `actionNote` | varchar(191) null |  |  |
| `reviewedBy` | varchar(191) null |  | plain text, **no FK** — may be an `admins` row |
| `rejectionReason` | varchar(191) null |  |  |
| `reviewedAt` | datetime(3) null |  |  |
| `createdAt` | datetime(3) |  |  |
| `updatedAt` | datetime(3) |  |  |

## Keys

- Primary key: `id`

## Indexes

- `isActive` — index
- `nim` — unique
- `status` — index
- `userId` — unique

## Relations

- `user`: one row here relates to a row in `users`, matched on `users.id` = `seller_verifications.userId` (declared in `src/schema.js`)
