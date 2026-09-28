# internal (agent machine API) — implemented

Same-network trust, no auth yet (add an internal key before exposing beyond
localhost). Never returns emails, hashes, or KTM data.

| Method | Path | Success | Errors |
|---|---|---|---|
| GET | `/api/internal/products/search?q=&limit=` | `200 {items}` (ACTIVE, case-insensitive) | `503 DB_UNAVAILABLE` |
| GET | `/api/internal/products/:id` | `200 {item}` + public seller | `404 PRODUCT_NOT_FOUND`, `503 DB_UNAVAILABLE` |
| GET | `/api/internal/users/:id` | `200 {item}` (`id, username, name, role, universitas`) | `404 USER_NOT_FOUND`, `503 DB_UNAVAILABLE` |
| POST | `/api/internal/contact-requests` | `202 {status: queued}` intake stub | `400 VALIDATION`, `404 PRODUCT_NOT_FOUND` / `USER_NOT_FOUND` |
