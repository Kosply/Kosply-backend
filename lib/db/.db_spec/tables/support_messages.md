# support_messages — implemented

Replies in a ticket, including admin-only internal notes.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `ticketId` | varchar(191) | FK (ticket → support_tickets.id) |  |
| `senderId` | varchar(191) null |  | nullable: a dashboard admin has no `users` row |
| `senderRole` | varchar(191) |  | role at send time |
| `senderName` | varchar(191) null |  | name snapshot, so a deleted sender stays readable |
| `text` | text |  |  |
| `imageUrl` | varchar(191) null |  |  |
| `isInternal` | tinyint(1) |  | admin-to-admin note, hidden from the reporter |
| `isRead` | tinyint(1) |  |  |
| `readAt` | datetime(3) null |  |  |
| `createdAt` | datetime(3) |  |  |

## Keys

- Primary key: `id`

## Indexes

- `senderId` — index
- `ticketId`, `createdAt` — index

## Relations

- `ticket`: one row here relates to a row in `support_tickets`, matched on `support_tickets.id` = `support_messages.ticketId` (declared in `src/schema.js`)
