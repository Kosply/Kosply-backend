# models — implemented

Registry behind the Flutter selector. Public list shows active models only.

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/models` | none | — | `200 {items}` (active, with USD pricing) | — |
| POST | `/api/models` | JWT + ADMIN | `modelId` (unique), `name`, `inputPrice`, `outputPrice`, `cacheReadPrice?` | `201` | `400 VALIDATION`, `409 MODEL_EXISTS`, `403 FORBIDDEN` |
| PATCH | `/api/models/:id` | JWT + ADMIN | partial (incl. `isActive` enable/disable) | `200` | `404 MODEL_NOT_FOUND`, `409 MODEL_EXISTS` |
| DELETE | `/api/models/:id` | JWT + ADMIN | — | `200` | `404 MODEL_NOT_FOUND`, `409 MODEL_IN_USE` |
