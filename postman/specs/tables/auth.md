# auth — implemented

Login is email-only. Buyer register needs no KTM.

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/auth/register` | none | `email, username, name, password (6+), universitas, programStudi` | `201 {user, token}` (role BUYER) | `400 VALIDATION`, `409 EMAIL_TAKEN` / `USERNAME_TAKEN` |
| POST | `/api/auth/login` | none | `email, password` | `200 {user, token}` (`{sub, role}` inside) | `400 VALIDATION`, `401 INVALID_CREDENTIALS` |
| POST | `/api/auth/forgot-password` | none | `email` | `200 {status}` always (no enumeration) + `devCode` outside production | `400 VALIDATION` |
| POST | `/api/auth/reset-password` | none | `email, code, newPassword (6+)` | `200 {status}` (single-use code) | `400 RESET_INVALID` (bad/expired/used/locked), `400 VALIDATION` |
| POST | `/api/auth/google` | none | `idToken` (from `google_sign_in`) | `200 {user, token, onboardingRequired, isNew}` | `400 VALIDATION`, `401 SOCIAL_AUTH_FAILED` |
| POST | `/api/auth/apple` | none | `identityToken` (+ `givenName?`, `familyName?` first login) | `200 {user, token, onboardingRequired, isNew}` | `400 VALIDATION`, `401 SOCIAL_AUTH_FAILED` — **disabled by default** (`403 SOCIAL_DISABLED` until iOS ships; enable via `APPLE_LOGIN_ENABLED=true`) |

## Onboarding

Social accounts are created shell-first (empty campus fields,
`onboardingRequired: true`); Flutter completes them via `PATCH /api/users/me`.
Verified emails link to existing accounts automatically.
