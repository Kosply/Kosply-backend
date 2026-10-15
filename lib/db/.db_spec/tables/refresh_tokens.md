# refresh_tokens — implemented

Session state that makes revocation possible: the access token is a stateless JWT, so without this table a session cannot be ended before it expires on its own. Holds only an HMAC of the token, never the token.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | varchar(191) | PK |  |
| `subjectType` | varchar(191) |  | `user`/`staff`/`admin` — the table the identity lives in AND the token shape |
| `subjectId` | varchar(191) |  | id in that namespace; no FK, the namespaces are disjoint |
| `familyId` | varchar(191) |  | every token descended from one login; reuse detection revokes the family |
| `tokenHash` | char(64) |  | `HMAC-SHA256(REFRESH_TOKEN_SECRET, token)` — the token itself is never stored |
| `expiresAt` | datetime(3) |  | now + `REFRESH_TOKEN_TTL_DAYS` |
| `consumedAt` | datetime(3) |  | set when rotated away; presenting it again is a replay |
| `revokedAt` | datetime(3) |  | set when the session ended on purpose — logout or reuse detection |
| `replacedById` | varchar(191) |  | the successor issued when this token was rotated |
| `userAgent` | varchar(191) |  | audit hint only, never used for an auth decision |
| `ip` | varchar(191) |  | audit hint only, attacker-controlled behind a proxy |
| `createdAt` | datetime(3) |  |  |

## Keys

- Primary key: `id`

## Indexes

- `expiresAt` — index
- `familyId` — index
- `subjectType`, `subjectId` — index
- `tokenHash` — unique
