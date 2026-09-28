# seller_verifications — implemented

ID/KTM verification for students who want to sell. One user has one application (`userId` unique).

## Columns

| Column | Type | Constraint | Notes |
|---|---|---|---|
| `id` | String (cuid) | PK | verification id |
| `userId` | String | unique, FK `users.id` Cascade | applicant |
| `namaLengkap` | String | not null | name as printed on KTM (audit, may differ from `users.name` display) |
| `nim` | String | unique, not null | student ID number |
| `universitas` | String | not null | university |
| `programStudi` | String | not null | study program |
| `ktmImageUrl` | String | not null | KTM photo, **private — admin only** |
| `status` | `VerificationStatus` | default `PENDING` | `PENDING \| APPROVED \| REJECTED` |
| `isActive` | Boolean | default `true` | active/non-active status. `false` = frozen, cannot sell |
| `action` | `VerificationAction` | default `NONE` | admin action: `APPROVE \| REJECT` |
| `actionNote` | String? | nullable | approve/reject reason |
| `reviewedBy` | String? | FK `users.id` SetNull | deciding admin |
| `rejectionReason` | String? | nullable | rejection reason (shown to the applicant) |
| `reviewedAt` | DateTime? | nullable | decision time |
| `createdAt` / `updatedAt` | DateTime | auto | |

## Indexes

- `@@index([status])`, `@@index([isActive])` — admin dashboard filters.

## Flow (admin dashboard)

1. Application arrives: `status=PENDING, action=NONE, isActive=true`.
2. Admin clicks Approve → `action=APPROVE, status=APPROVED, reviewedBy, reviewedAt`, service promotes `users.role=SELLER`.
3. Admin clicks Reject → `action=REJECT, status=REJECTED, rejectionReason`.
4. Problematic seller (fraud report): admin sets `isActive=false` without deleting data — they can no longer sell.
