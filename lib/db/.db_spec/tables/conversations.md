# conversations — implemented

COD chat room per product. The transaction happens off-system (direct COD with the person); chat is only the bridge + history.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | String (cuid) | PK | |
| `productId` | String? | FK `products.id` SetNull, nullable | product context; `null` = general chat; deleting a product does not delete history |
| `buyerId` | String | FK `users.id` Cascade | buyer |
| `sellerId` | String | FK `users.id` Cascade | seller |
| `agreedLatitude` | Float? | nullable | COD point agreed in the conversation (`null` = follow the product location) |
| `agreedLongitude` | Float? | nullable | |
| `agreedLocationLabel` | String? | nullable | final COD point label |
| `lastMessageAt` | DateTime? | nullable | inbox sorting |
| `createdAt` / `updatedAt` | DateTime | auto | |

## Constraints & indexes

- `@@unique([productId, buyerId])` — 1 buyer x 1 product = 1 room (no duplicate rooms).
- `@@index([buyerId])`, `[sellerId]`, `[productId]` — buyer/seller inbox.
