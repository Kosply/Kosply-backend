# verifications — implemented

One active application per user; rejected applicants may resubmit.

| Method | Path | Auth | Body / Query | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/verifications` | JWT | `namaLengkap, nim, universitas, programStudi, ktmImageUrl` | `201` (`PENDING`) | `400 VALIDATION`, `409 VERIFICATION_EXISTS` |
| GET | `/api/verifications/me` | JWT | — | `200 {item\|null}` (KTM URL visible: owner route) | `401` |
| GET | `/api/verifications` | JWT + ADMIN | `status?` (PENDING/APPROVED/REJECTED) | `200 {items}` newest first | `403 FORBIDDEN` |
| POST | `/api/verifications/:id/review` | JWT + ADMIN | `action: APPROVE\|REJECT`, `actionNote?`, `rejectionReason?` (required on REJECT) | `200` (APPROVE promotes to SELLER) | `400 VALIDATION`, `403 FORBIDDEN` |
