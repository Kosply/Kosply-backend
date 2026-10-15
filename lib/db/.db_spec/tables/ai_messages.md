# ai_messages — implemented

Messages inside an AI session.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `conversationId` | varchar(191) | FK (conversation → ai_conversations.id) |  |
| `role` | enum |  | who spoke |
| `content` | text |  |  |
| `model` | varchar(191) null |  | must match `ai_models.modelId` for cost tracking |
| `createdAt` | datetime(3) |  |  |

## Keys

- Primary key: `id`

## Indexes

- `conversationId`, `createdAt` — index

## Relations

- `conversation`: one row here relates to a row in `ai_conversations`, matched on `ai_conversations.id` = `ai_messages.conversationId` (declared in `src/schema.js`)
