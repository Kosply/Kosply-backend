# ai_models — implemented

Registry of AI models the client may pick, with per-token pricing.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `modelId` | varchar(191) |  | code used by the app |
| `name` | varchar(191) |  |  |
| `inputPrice` | double |  |  |
| `outputPrice` | double |  |  |
| `cacheReadPrice` | double |  | USD per 1M cache-read tokens |
| `isActive` | tinyint(1) |  | false = hidden from the picker, history kept |
| `createdAt` | datetime(3) |  |  |
| `updatedAt` | datetime(3) |  | maintained by the statement builder |

## Keys

- Primary key: `id`

## Indexes

- `isActive` — index
- `modelId` — unique
