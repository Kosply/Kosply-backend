# admins — implemented

Dashboard operator accounts. Separate from `users` so marketplace and dashboard sessions never mix.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `email` | varchar(191) |  | dashboard login identifier |
| `name` | varchar(191) |  |  |
| `passwordHash` | varchar(191) |  | never store plain text |
| `isActive` | tinyint(1) |  | false = dashboard access revoked |
| `createdAt` | datetime(3) |  |  |
| `updatedAt` | datetime(3) |  | maintained by the statement builder |

## Keys

- Primary key: `id`

## Indexes

- `email` — unique
