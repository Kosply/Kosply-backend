# support_tickets — implemented

User → support help tickets. Name/username are not duplicated — they are resolved via the `user` join.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | String (cuid) | PK | |
| `ticketNo` | String | unique, not null | display number `KSP-YYYYMMDD-XXXX` (generated in service) |
| `userId` | String | FK `users.id` Cascade | reporter (name/username via relation) |
| `category` | `SupportTicketCategory` | default `LAINNYA` | `AKUN \| PRODUK \| CHAT \| VERIFIKASI \| LAPORAN \| LAINNYA` |
| `status` | `SupportTicketStatus` | default `ACTIVE` | `ACTIVE` = being handled, `CLOSED` = inactive/done |
| `subject` | String | not null | ticket title |
| `description` | Text | not null | initial complaint (context, not chat) |
| `lastMessageAt` | DateTime? | nullable | dashboard sorting |
| `createdAt` / `updatedAt` | DateTime | auto | |

## Indexes

- `[userId]`, `[status]`, `[category]` — dashboard filters.

## Dashboard

List tickets with `status=ACTIVE` → click → open the chat (`support_messages`) with the person concerned.
