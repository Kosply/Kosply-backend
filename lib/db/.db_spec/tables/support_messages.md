# support_messages — implemented

Chat inside a support ticket. The sender can be the reporter or an admin.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | String (cuid) | PK | |
| `ticketId` | String | FK `support_tickets.id` Cascade | |
| `senderId` | String | FK `users.id` Cascade | reporter or `role=ADMIN` |
| `text` | Text | not null | chat content |
| `imageUrl` | String? | nullable | screenshot / evidence |
| `isInternal` | Boolean | default `false` | admin-to-admin note — **hidden from the reporter** |
| `isRead` | Boolean | default `false` | |
| `readAt` | DateTime? | nullable | |
| `createdAt` | DateTime | default now() | |

## Indexes

- `@@index([ticketId, createdAt])`, `@@index([senderId])`.
