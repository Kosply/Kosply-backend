# products — implemented

Student second-hand catalog. Seller = `users` with `role=SELLER`.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | String (cuid) | PK | |
| `sellerId` | String | FK `users.id` Cascade | storefront owner |
| `title` | String | not null | title |
| `description` | Text | not null | second-hand condition description |
| `price` | Int | not null | rupiah, `>= 0` (service validation) |
| `stock` | Int | default `1` | quantities / stock |
| `imageUrls` | String[] | default `[]` | item photos 1..N, cover = `[0]` |
| `category` | String? | nullable | **blank for now**, TODO: become a `Category` FK |
| `latitude` | Float? | nullable | item location, set when creating the catalog |
| `longitude` | Float? | nullable | |
| `locationLabel` | String? | nullable | location label, e.g. boarding-house / campus area |
| `status` | `ProductStatus` | default `ACTIVE` | `ACTIVE \| SOLD \| ARCHIVED` |
| `createdAt` / `updatedAt` | DateTime | auto | |

## Indexes

- `[sellerId]`, `[status]`, `[category]` — catalog + seller storefront filters.

## Relations

- `conversations`: chat rooms discussing this product.
- `reports`: fraud reports against this listing.

## Rules

- Admin deletion (`ReportAction.DELETE_PRODUCT`) = set `status=ARCHIVED`, never hard-delete so chat/report history stays intact.
