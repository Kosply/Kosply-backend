# tool_invocations — implemented

Append-only log of AI tool calls, feeding `GET /api/tools/stats`. Replaces the hardcoded benchmark numbers the dashboard used to show.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `tool` | varchar(191) |  | e.g. `search_products` |
| `model` | varchar(191) null |  | `ai_models.modelId` that produced the call |
| `userId` | varchar(191) null |  | plain text, **no FK** — counters outlive the account |
| `status` | enum |  | outcome of the call |
| `latencyMs` | int(11) null |  | wall time, nullable when unmeasured |
| `createdAt` | datetime(3) |  |  |

## Keys

- Primary key: `id`

## Indexes

- `model`, `createdAt` — index
- `status`, `createdAt` — index
- `tool`, `createdAt` — index
