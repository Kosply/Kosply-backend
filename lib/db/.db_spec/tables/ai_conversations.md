# ai_conversations — implemented

Resumable AI chat sessions. The row id is the agent's thread id.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `userId` | varchar(191) |  |  |
| `title` | varchar(191) |  | auto-filled from the first message, editable |
| `lastMessageAt` | datetime(3) null |  | drives history ordering |
| `createdAt` | datetime(3) |  |  |
| `updatedAt` | datetime(3) |  | maintained by the statement builder |

## Keys

- Primary key: `id`

## Indexes

- `userId`, `updatedAt` — index
