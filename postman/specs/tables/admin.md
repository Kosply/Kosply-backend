# admin — implemented

Separate credentials from marketplace users (`admins` table). Tokens carry
role ADMIN so the shared JWT middleware works.

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/admin/login` | none | `email, password` | `200 {admin, token}` (active admins only) | `400 VALIDATION`, `401 INVALID_CREDENTIALS` |

Seed one via `ADMIN_SEED_EMAIL` + `ADMIN_SEED_PASSWORD` then `npm run seed` in `lib/db`. Revoke with `isActive=false` (never delete rows).
