# ai_messages — implemented

One message inside an AI chat session — either the human side or the AI side.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | String (cuid) | PK | |
| `conversationId` | String | FK `ai_conversations.id` Cascade | |
| `role` | `AiMessageRole` | default `USER` | `USER \| ASSISTANT \| SYSTEM` (system = hidden instruction/context) |
| `content` | Text | not null | message body |
| `model` | String? | nullable | AI model used for `ASSISTANT` messages |
| `createdAt` | DateTime | default now() | history ordering |

## Indexes

- `@@index([conversationId, createdAt])` — fast history load for resume.
