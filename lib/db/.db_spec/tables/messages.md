# messages — implemented

Chat bubbles inside a conversation.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `conversationId` | varchar(191) | FK (conversation → conversations.id) |  |
| `senderId` | varchar(191) |  |  |
| `type` | enum |  | bubble kind |
| `text` | text null |  | required for `TEXT` |
| `imageUrl` | varchar(191) null |  | required for `IMAGE`; scheme-checked |
| `latitude` | double null |  | required for `LOCATION` |
| `longitude` | double null |  | required for `LOCATION` |
| `locationLabel` | varchar(191) null |  | required for `LOCATION` |
| `isRead` | tinyint(1) |  |  |
| `readAt` | datetime(3) null |  |  |
| `createdAt` | datetime(3) |  |  |

## Keys

- Primary key: `id`

## Indexes

- `conversationId`, `createdAt` — index
- `senderId` — index

## Relations

- `conversation`: one row here relates to a row in `conversations`, matched on `conversations.id` = `messages.conversationId` (declared in `src/schema.js`)
