# reports — implemented

Fraud reports from the catalog (Report button in the UI).

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | String (cuid) | PK | internal report id |
| `reportNo` | String | unique, not null | display number `RPT-YYYYMMDD-XXXX` (generated in service) |
| `reporterId` | String | FK `users.id` Cascade | reporter |
| `reportedUserId` | String? | FK `users.id` SetNull, nullable | fraud / reported person; `null` = reporting only a listing |
| `reportedProductId` | String? | FK `products.id` SetNull, nullable | reported listing; `null` = reporting only a user |
| `category` | `ReportCategory` | default `LAINNYA` | UI options: `PENIPUAN \| BARANG_PALSU \| BARANG_TIDAK_SESUAI \| HARGA_MENYESATKAN \| KONTEN_TIDAK_PANTAS \| SPAM \| LAINNYA` |
| `description` | Text | not null | report detail |
| `evidenceUrls` | String[] | default `[]` | screenshots / chat evidence |
| `status` | `ReportStatus` | default `PENDING` | `PENDING \| IN_REVIEW \| RESOLVED \| REJECTED` |
| `action` | `ReportAction` | default `NONE` | `WARNING \| DELETE_PRODUCT (remove listing) \| BAN_USER` |
| `actionNote` | String? | nullable | action reason |
| `reviewedBy` | String? | FK `users.id` SetNull | acting admin |
| `reviewedAt` | DateTime? | nullable | |
| `createdAt` / `updatedAt` | DateTime | auto | |

## Indexes

- `[reporterId]`, `[reportedUserId]`, `[reportedProductId]`, `[status]`, `[category]`.

## Rules

- At least one target must be filled (`reportedUserId` and/or `reportedProductId`) — validated in the service.
- Action execution in the admin service: `WARNING` → flag; `DELETE_PRODUCT` → `products.status=ARCHIVED`; `BAN_USER` → freeze (`seller_verifications.isActive=false` and/or deactivate the user).
