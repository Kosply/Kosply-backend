# favorites — implemented

Saved listings — the product-detail heart, persisted per user. A save is the
(`userId`, `productId`) pair, so both writes are idempotent.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `userId` | varchar(191) | PK | half of the composite primary key |
| `productId` | varchar(191) | PK | half of the composite primary key |
| `createdAt` | datetime(3) |  | save time; ordering key for the saved list |

## Keys

- Primary key: `userId, productId`
- No surrogate id. The data layer looks this up through `__primaryKey` in `src/schema.js`.
- A save is immutable until removed: a repeated `PUT` keeps the original `createdAt`, so it does not move to the top of the list.

## Indexes

- `userId`, `productId` — primary key
- `productId` — index

## Relations

- `product`: one row here relates to a row in `products`, matched on `products.id` = `favorites.productId` (declared as `products.favorites` in `src/schema.js`)
- `userId` has no declared relation edge: every read is scoped directly by the authenticated user's id.

## Notes

- No foreign keys, unlike the rest of the schema: integrity is managed in the data layer. The service validates the product before inserting, and the list drops `ARCHIVED` products while keeping `SOLD` ones.
