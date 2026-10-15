# reports — implemented

Fraud reports against a listing and/or a user, with the admin action taken.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `reportNo` | varchar(191) |  | `RPT-YYYYMMDD-XXXX`, unique, retried on collision |
| `reporterId` | varchar(191) |  |  |
| `reportedUserId` | varchar(191) null | FK (reportedUser → users.id) | nullable, `SetNull` |
| `reportedProductId` | varchar(191) null | FK (reportedProduct → products.id) | nullable, `SetNull` |
| `category` | enum |  |  |
| `description` | text |  | report detail from the UI |
| `evidenceUrls` | longtext |  | JSON array of screenshot URLs; `CHECK (JSON_VALID(...))` |
| `status` | enum |  |  |
| `action` | enum |  |  |
| `actionNote` | varchar(191) null |  |  |
| `reviewedBy` | varchar(191) null |  | plain text, **no FK** — may be an `admins` row |
| `reviewedAt` | datetime(3) null |  |  |
| `createdAt` | datetime(3) |  |  |
| `updatedAt` | datetime(3) |  | maintained by the statement builder |

## Keys

- Primary key: `id`

## Indexes

- `category` — index
- `reportedProductId` — index
- `reportedUserId` — index
- `reporterId` — index
- `reportNo` — unique
- `status` — index

## Relations

- `reportedProduct`: one row here relates to a row in `products`, matched on `products.id` = `reports.reportedProductId` (declared in `src/schema.js`)
- `reportedUser`: one row here relates to a row in `users`, matched on `users.id` = `reports.reportedUserId` (declared in `src/schema.js`)
