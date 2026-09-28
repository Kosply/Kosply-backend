# admins — implemented

Admin accounts for the dashboard only. Deliberately a separate table (apart from `users`) so dashboard sessions never mix with marketplace sessions.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | String (cuid) | PK | |
| `email` | String | unique, not null | dashboard login |
| `name` | String | not null | admin name shown in the dashboard |
| `passwordHash` | String | not null | never store plain text |
| `isActive` | Boolean | default `true` | `false` = dashboard access revoked |
| `createdAt` / `updatedAt` | DateTime | auto | |

## Rules

- Seed 1 initial admin via service/seed (email + password from env, hashed first).
- Revoke access by setting `isActive=false`, never delete the row (audit).
- Different from `users.role=ADMIN`: `users` is for the marketplace (reporters/sellers), `admins` is for dashboard login.
