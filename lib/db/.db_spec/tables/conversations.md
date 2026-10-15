# conversations — implemented

One COD chat room per buyer per product. Unique `(productId, buyerId)`; `productId` null means general chat.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `productId` | varchar(191) null | FK (product → products.id) | nullable; `SetNull` keeps history when a product is deleted |
| `buyerId` | varchar(191) |  | buyer side |
| `sellerId` | varchar(191) |  | seller side |
| `agreedLatitude` | double null |  |  |
| `agreedLongitude` | double null |  |  |
| `agreedLocationLabel` | varchar(191) null |  |  |
| `lastMessageAt` | datetime(3) null |  | drives inbox ordering |
| `createdAt` | datetime(3) |  |  |
| `updatedAt` | datetime(3) |  | maintained by the statement builder |

## Keys

- Primary key: `id`

## Indexes

- `buyerId` — index
- `productId`, `buyerId` — unique
- `productId` — index
- `sellerId` — index

## Relations

- `product`: one row here relates to a row in `products`, matched on `products.id` = `conversations.productId` (declared in `src/schema.js`)
- `messages`: one row here relates to a row in `messages`, matched on `messages.conversationId` = `conversations.id` (declared in `src/schema.js`)
