# users — implemented

Base account. Buyer vs seller is distinguished by `role` + the `seller_verifications` relation.

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | String (cuid) | PK | |
| `email` | String | unique, not null | email is enough for buyer login |
| `username` | String | unique, not null | shown in UI |
| `name` | String | not null | display name |
| `passwordHash` | String | not null | never store plain text |
| `universitas` | String | not null | required for buyer + seller |
| `programStudi` | String | not null | required for buyer + seller |
| `bio` | Text? | nullable | seller storefront bio, shown on the seller profile |
| `role` | `UserRole` | default `BUYER` | `BUYER \| SELLER \| ADMIN` |
| `createdAt` | DateTime | default now() | |
| `updatedAt` | DateTime | auto update | |

## Relations

- `sellerVerification`: 1 user has 0..1 verification applications.
- `products`: 1 seller has N products.
- `buyerConversations` / `sellerConversations`: COD chat history.
- `sentMessages`, `supportMessagesSent`: sent messages.
- `supportTickets`: tickets reported by the user.
- `reportsMade` (reporter) / `reportsReceived` (reported) / `reportsReviewed` (admin).
- `verificationsReviewed`: KTM verifications decided by this admin.

## Rules

- Buyer (regular customer): `email, name, username, password, universitas, programStudi`. No KTM.
- Seller: a buyer who passes KTM verification → `role = SELLER`.
- `nim` and KTM are not stored here, but in `seller_verifications`.
