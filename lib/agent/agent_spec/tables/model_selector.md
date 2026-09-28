# model-selector — planned

Flow (not built yet): Flutter model picker → `ai_models` row → agent call.

| Step | Owner | Notes |
|---|---|---|
| 1. Picker lists models | Flutter reads `ai_models where isActive` (via server endpoint, TODO) | show `name` + prices |
| 2. User picks one | Flutter sends `model_id` per chat call | new optional field on the chat request |
| 3. Agent resolves it | agent looks up `ai_models` by `modelId` | reject unknown/disabled with 400; needs `provider` + `base_url` columns (schema TODO) |
| 4. Call + track cost | agent calls that provider, logs tokens × price | needs `tokens`/`cost` columns on `ai_messages` (schema TODO) |

## Rules

| Rule | Notes |
|---|---|
| DB is the source of truth | no hardcoded model lists in Flutter or the agent |
| Disabled means disabled | `isActive=false` is rejected even if requested directly |
| Pricing stays in `ai_models` | USD per 1M tokens; computation happens server-side, never in Flutter |
