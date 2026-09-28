# messages — implemented

One COD chat bubble. Content depends on `type`.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | String (cuid) | PK | |
| `conversationId` | String | FK `conversations.id` Cascade | |
| `senderId` | String | FK `users.id` Cascade | sender (buyer/seller) |
| `type` | `MessageType` | default `TEXT` | `TEXT \| IMAGE \| LOCATION \| SYSTEM` |
| `text` | Text? | nullable | used when `TEXT` |
| `imageUrl` | String? | nullable | used when `IMAGE` (item photo / proof) |
| `latitude` | Float? | nullable | used when `LOCATION` |
| `longitude` | Float? | nullable | used when `LOCATION` |
| `locationLabel` | String? | nullable | COD point label, used when `LOCATION` |
| `isRead` | Boolean | default `false` | |
| `readAt` | DateTime? | nullable | |
| `createdAt` | DateTime | default now() | history ordering |

## Indexes

- `@@index([conversationId, createdAt])` — fast history pagination.
- `@@index([senderId])`.
