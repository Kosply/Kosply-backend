# products — implemented

The second-hand catalog. Seller = a `users` row with an approved, active verification.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `sellerId` | varchar(191) |  | storefront owner |
| `title` | varchar(191) |  |  |
| `description` | text |  |  |
| `price` | int(11) |  | rupiah; `CHECK (price >= 0)` |
| `stock` | int(11) |  | `CHECK (stock >= 0)` |
| `imageUrls` | longtext |  | JSON array of URLs, cover = `[0]`; `CHECK (JSON_VALID(...))` |
| `category` | varchar(191) null |  | free text, **blank for now**, TODO: a `Category` FK |
| `latitude` | double null |  | `CHECK` within ±90 |
| `longitude` | double null |  | `CHECK` within ±180 |
| `locationLabel` | varchar(191) null |  |  |
| `status` | enum |  | lifecycle state |
| `soldAt` | datetime(3) null |  | immutable sale fact; analytics key off this, not `status` |
| `createdAt` | datetime(3) |  |  |
| `updatedAt` | datetime(3) |  | maintained by the statement builder |

## Keys

- Primary key: `id`

## Indexes

- `category` — index
- `sellerId` — index
- `sellerId`, `soldAt` — index
- `sellerId`, `status` — index
- `status`, `createdAt` — index
- `status` — index

## Relations

- `events`: one row here relates to a row in `product_events`, matched on `product_events.productId` = `products.id` (declared in `src/schema.js`)
- `conversations`: one row here relates to a row in `conversations`, matched on `conversations.productId` = `products.id` (declared in `src/schema.js`)
