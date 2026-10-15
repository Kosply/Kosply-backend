# notifications — implemented

The in-app inbox. Rows are written by services only when the matching preference is on.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `userId` | varchar(191) |  |  |
| `type` | varchar(191) |  | `chat`/`verification`/`reports`/`support`/`product`/`system` |
| `title` | varchar(191) |  |  |
| `body` | text |  |  |
| `data` | longtext null |  | JSON deep-link payload; `CHECK (JSON_VALID(...))` |
| `isRead` | tinyint(1) |  |  |
| `readAt` | datetime(3) null |  |  |
| `createdAt` | datetime(3) |  |  |

## Keys

- Primary key: `id`

## Indexes

- `userId`, `createdAt` — index
