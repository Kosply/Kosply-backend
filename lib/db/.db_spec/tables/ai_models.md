# ai_models — implemented

AI model registry. Admins add models here; chat sessions reference them via `modelId`.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | String (cuid) | PK | internal id |
| `modelId` | String | unique, not null | code used in the app, e.g. `muse-spark-1.3` |
| `name` | String | not null | display name, e.g. Muse Spark 1.3 |
| `inputPrice` | Float | not null | USD per 1M input tokens |
| `outputPrice` | Float | not null | USD per 1M output tokens |
| `cacheReadPrice` | Float | default `0` | USD per 1M cache-read tokens |
| `isActive` | Boolean | default `true` | `false` = disabled, cannot be picked for new chats |
| `createdAt` / `updatedAt` | DateTime | auto | |

## Indexes

- `@@index([isActive])` — model picker lists `isActive=true` only.

## Actions (admin)

- Add → insert row (`modelId` must be unique).
- Disable → set `isActive=false` (hidden from picker, existing history untouched).
- Enable → set `isActive=true`.
- Delete → hard delete the row (only allowed when no `ai_messages` reference its `modelId`; otherwise disable instead).

## Rules

- `ai_messages.model` must match an `ai_models.modelId` so usage cost can be computed as `inputTokens/1M*inputPrice + outputTokens/1M*outputPrice + cacheReadTokens/1M*cacheReadPrice`.
