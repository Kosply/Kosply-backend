# products — implemented

| Method | Path | Auth | Body / Query | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/products` | none | `q?`, `limit?` (1–50, default 20) | `200 {items}` (ACTIVE only, newest first) | — |
| GET | `/api/products/:id` | none | — | `200 {item}` with public seller | `404 PRODUCT_NOT_FOUND` |
| POST | `/api/products` | JWT + SELLER/ADMIN | `title, description, price (int ≥ 0), stock?, category?, imageUrls?` | `201 {item}` | `400 VALIDATION`, `401`, `403 FORBIDDEN` |
| PATCH | `/api/products/:id` | JWT (owner or ADMIN) | partial fields | `200 {item}` | `404 PRODUCT_NOT_FOUND`, `403 FORBIDDEN` |
| DELETE | `/api/products/:id` | JWT (owner or ADMIN) | — | `200 {item}` (`ARCHIVED`, history kept) | `404 PRODUCT_NOT_FOUND`, `403 FORBIDDEN` |
