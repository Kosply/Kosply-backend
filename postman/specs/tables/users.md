# users — implemented

Everyone has name + username; sellers add bio; photo is a URL.

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/users/me` | JWT | — | `200 {item}` own profile | `401` |
| PATCH | `/api/users/me` | JWT | `name?, username?, bio?, photo?, universitas?, programStudi?` (email/password locked) | `200 {item}` | `400 VALIDATION`, `409 USERNAME_TAKEN` |
| GET | `/api/users/:id` | none | — | `200 {item}` public (no email/hash) | `404 USER_NOT_FOUND` |
