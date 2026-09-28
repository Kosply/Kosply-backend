# ai_conversations — implemented

AI chat session between a user and the AI. Resumable — the user can reopen a session and continue it anytime.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | String (cuid) | PK | |
| `userId` | String | FK `users.id` Cascade | session owner |
| `title` | String | not null | session title shown in the history list; auto-filled from the first message, editable |
| `lastMessageAt` | DateTime? | nullable | history-list sorting |
| `createdAt` / `updatedAt` | DateTime | auto | |

## Indexes

- `@@index([userId, updatedAt])` — per-user history list.

## Flow

1. First user message → create `AiConversation` (title = truncated first message) + `AiMessage(role=USER)`.
2. Reopen session → load `ai_messages` ordered by `createdAt` → append new `USER` / `ASSISTANT` pairs.
3. Rename → update `title` only.

## Agent mapping

- `lib/agent` uses this `id` as the LangGraph `thread_id`, so the checkpointer
  history and these tables stay aligned per session.
