# help_topics — implemented

Public FAQ catalog served by `GET /api/support/help-topics`. Read-only for the
app; `isActive` is the soft-remove switch.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `title` | varchar(191) |  |  |
| `answer` | text |  |  |
| `sortOrder` | int(11) |  | default `0`; ties broken by `createdAt` so the order is stable |
| `isActive` | tinyint(1) |  | default `true`; false = hidden from the Help desk, row kept |
| `createdAt` | datetime(3) |  | default `CURRENT_TIMESTAMP(3)` |
| `updatedAt` | datetime(3) |  | maintained by the statement builder |

## Keys

- Primary key: `id`

## Indexes

- `isActive`, `sortOrder` — index

## Notes

- Standalone catalog: no relations and no foreign keys.
- The service reads only `isActive = true`, smallest `sortOrder` first, capped at 50 rows.
