# admin — implemented

Separate credentials from marketplace users (`admins` table). Tokens carry
role ADMIN so the shared JWT middleware works.

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/admin/login` | none | `email, password` | `200 {admin, token}` (active admins only) | `400 VALIDATION`, `401 INVALID_CREDENTIALS` |
| POST | `/api/admin/users` | JWT + SUPER_ADMIN | `email, username, name, password (8+), photo?, role?` (ADMIN/SUPER_ADMIN) | `201` (password set once here) | `400 VALIDATION`, `409 EMAIL_TAKEN` / `USERNAME_TAKEN`, `403 FORBIDDEN` |
| PATCH | `/api/admin/users/me` | JWT + ADMIN/SUPER_ADMIN | `name?, username?, photo?` (password/email locked) | `200` | `400 VALIDATION` |
| PATCH | `/api/admin/users/:id` | JWT + SUPER_ADMIN | `name?, username?, photo?, isActive?` | `200` (freezing blocks login) | `400 VALIDATION`, `404 USER_NOT_FOUND`, `403 FORBIDDEN` |

Seed a super admin via `SUPERADMIN_SEED_EMAIL` + `SUPERADMIN_SEED_PASSWORD` then `npm run seed` in `lib/db`.
