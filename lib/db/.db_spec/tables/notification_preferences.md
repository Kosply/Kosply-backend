# notification_preferences — implemented

Per-key opt-out toggles. A missing row means enabled.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `userId` | varchar(191) | PK | half of the composite primary key |
| `key` | varchar(191) | PK | one of `chat`/`verification`/`reports`/`support`/`product`/`system` |
| `enabled` | tinyint(1) |  | missing row = enabled (opt-out) |
| `createdAt` | datetime(3) |  |  |
| `updatedAt` | datetime(3) |  |  |

## Keys

- Primary key: `userId, key`
- No surrogate id. The data layer looks this up through `__primaryKey` in `src/schema.js`.

## Indexes

- `userId`, `key` — unique
