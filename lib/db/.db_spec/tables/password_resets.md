# password_resets — implemented

4-digit OTP for password changes via email verification. Codes are never stored in plain text.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | String (cuid) | PK | |
| `userId` | String | FK `users.id` Cascade | account owner |
| `email` | String | not null, index | destination email snapshot (fast lookup) |
| `codeHash` | String | not null | 4-digit code hash (bcrypt), never plain |
| `expiresAt` | DateTime | not null | e.g. now + 10 minutes |
| `attempts` | Int | default `0` | wrong inputs, locked after 5 |
| `consumedAt` | DateTime? | nullable | filled = already used, cannot be reused |
| `createdAt` | DateTime | default now() | |

## Flow (future endpoints)

1. `POST /api/auth/forgot-password { email }` → find user, generate a 4-digit code, store `codeHash` + `expiresAt`, send the code to the email. Always respond success (never leak whether the email is registered).
2. `POST /api/auth/reset-password { email, code, newPassword }` → take the latest ticket that is not `consumedAt` and not `expiresAt`, check `attempts < 5`, compare the code hash → update `users.passwordHash`, set `consumedAt`.
3. Wrong code → `attempts + 1`. Requesting a new code → create a new row (let the old row expire).

## Rules

- Rate-limit code requests per email (e.g. max 3x per 15 minutes) in the service.
- Code length is 4 digits per the request; bcrypt-hash before storing.
