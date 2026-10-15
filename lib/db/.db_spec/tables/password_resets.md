# password_resets — implemented

One row per issued OTP. Single-use, expiring, attempt-limited.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `userId` | varchar(191) |  |  |
| `email` | varchar(191) |  |  |
| `codeHash` | varchar(191) |  | the 4-digit code, hashed — never plain |
| `expiresAt` | datetime(3) |  | now + 10 minutes |
| `attempts` | int(11) |  | wrong guesses; `CHECK (attempts >= 0)` |
| `consumedAt` | datetime(3) null |  | set on use; single-use |
| `createdAt` | datetime(3) |  |  |

## Keys

- Primary key: `id`

## Indexes

- `email` — index
- `userId` — index
