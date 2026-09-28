# reports — implemented

At least one target required. `NONE` dismisses (`REJECTED`); real actions resolve.

| Method | Path | Auth | Body / Query | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/reports` | JWT | `reportedUserId?`, `reportedProductId?`, `category?`, `description`, `evidenceUrls?` | `201` (`reportNo RPT-…`) | `400 VALIDATION` |
| GET | `/api/reports` | JWT + ADMIN | `status?`, `category?` | `200 {items}` | `403 FORBIDDEN` |
| POST | `/api/reports/:id/review` | JWT + ADMIN | `action: NONE\|WARNING\|DELETE_PRODUCT\|BAN_USER`, `actionNote?` | `200` (`RESOLVED`, or `REJECTED` on NONE) | `400 VALIDATION`, `404 REPORT_NOT_FOUND`, `403 FORBIDDEN` |

## Enforcement

| Action | Effect |
|---|---|
| `WARNING` | recorded only |
| `DELETE_PRODUCT` | listing → `ARCHIVED` |
| `BAN_USER` | seller verification `isActive=false` |
