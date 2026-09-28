# Kosply API Specs (Postman)

Source: `lib/server/routes/**` (Express 4). Status: **implemented** — every
endpoint below exists in the router (cross-checked programmatically) and is
covered by `npm test` (live parts skip without `DATABASE_URL`).

## Index

| API | Spec file | Auth |
|---|---|---|
| Health | `tables/health.md` | none |
| Auth | `tables/auth.md` | mixed (see file) |
| Products | `tables/products.md` | reads public, writes JWT |
| Verifications | `tables/verifications.md` | JWT (list/review ADMIN) |
| Conversations (COD) | `tables/conversations.md` | JWT, member-scoped |
| Support | `tables/support.md` | JWT (filters ADMIN) |
| Reports | `tables/reports.md` | JWT (list/review ADMIN) |
| Admin | `tables/admin.md` | none (separate credentials) |
| Models | `tables/models.md` | reads public, writes ADMIN |
| Internal (agent) | `tables/internal.md` | none (localhost trust) |
| AI proxy | `tables/ai.md` | JWT (identity from token) |

## Conventions

| Convention | Details |
|---|---|
| Auth header | `Authorization: Bearer <token>` (login/register return it) |
| Errors | `{status: error, code, message[, details]}` — codes in `lib/server/middlewares/errorCatalog.js` |
| Soft deletes | products archive (`ARCHIVED`); history is never hard-deleted |
| Display numbers | `KSP-YYYYMMDD-XXXX` (support), `RPT-YYYYMMDD-XXXX` (reports) |
