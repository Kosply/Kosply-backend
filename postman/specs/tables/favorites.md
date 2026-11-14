# favorites — implemented

The product-detail heart, persisted per user. A save is the
(`userId`, `productId`) pair, so both writes are idempotent.

| Method | Path | Auth | Body / Query | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/favorites` | JWT | — | `200 {items}` newest save first, seller attached | `401` |
| PUT | `/api/favorites/:productId` | JWT | — | `201 {item: {productId}}` (repeat-safe) | `401`, `404 PRODUCT_NOT_FOUND` |
| DELETE | `/api/favorites/:productId` | JWT | — | `200 {item: {productId, removed}}` (`removed: false` when nothing was saved) | `401` |

Notes:

- `PUT`, not `POST`: the save is fully identified by the URL, so a retried
  request cannot create a second row or reorder the list.
- The list drops `ARCHIVED` products (invisible everywhere else too) but keeps
  `SOLD` ones, so a student can still see what happened to a saved listing.
- Saving an unknown or archived product is `404`, not a row.
