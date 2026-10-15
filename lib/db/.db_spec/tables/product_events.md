# product_events — implemented

Append-only analytics events. Never exposed publicly — sellers read aggregated counts via `/api/analytics`.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `productId` | varchar(191) | FK (product → products.id) |  |
| `type` | enum |  | event kind |
| `viewerId` | varchar(191) null |  | plain text, **no FK** — deleting a viewer must not erase history |
| `source` | varchar(191) |  | `feed`/`search`/`share`/`detail`/`unknown` |
| `createdAt` | datetime(3) |  |  |

## Keys

- Primary key: `id`

## Indexes

- `productId`, `createdAt` — index
- `productId`, `type`, `createdAt` — index
- `type`, `createdAt` — index

## Relations

- `product`: one row here relates to a row in `products`, matched on `products.id` = `product_events.productId` (declared in `src/schema.js`)
