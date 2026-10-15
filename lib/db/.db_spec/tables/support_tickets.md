# support_tickets — implemented

A user-facing help ticket.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `ticketNo` | varchar(191) |  | `KSP-YYYYMMDD-XXXX`, unique, retried on collision |
| `userId` | varchar(191) |  |  |
| `category` | enum |  | dashboard filter |
| `status` | enum |  |  |
| `subject` | varchar(191) |  |  |
| `description` | text |  |  |
| `lastMessageAt` | datetime(3) null |  | drives triage ordering |
| `createdAt` | datetime(3) |  |  |
| `updatedAt` | datetime(3) |  | maintained by the statement builder |

## Keys

- Primary key: `id`

## Indexes

- `category` — index
- `status` — index
- `ticketNo` — unique
- `userId` — index
