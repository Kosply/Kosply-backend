# conversations (COD) — implemented

One room per buyer per product (`productId` derives the seller — no spoofing).
Strangers get 404 (never a leak).

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/conversations` | JWT | `productId?` (or `sellerId`), optional first `message` | `201` room with messages | `400 VALIDATION`, `404 PRODUCT_NOT_FOUND` / `USER_NOT_FOUND` |
| GET | `/api/conversations` | JWT | — | `200 {items}` inbox, newest activity first | `401` |
| GET | `/api/conversations/:id` | JWT member | — | `200 {item}` + product context | `404 CONVERSATION_NOT_FOUND` |
| POST | `/api/conversations/:id/messages` | JWT member | `type` (TEXT/IMAGE/LOCATION/SYSTEM) + `text` / `imageUrl` / `latitude+longitude` | `201` message (bumps `lastMessageAt`) | `400 VALIDATION`, `404 CONVERSATION_NOT_FOUND` |
| GET | `/api/conversations/:id/messages` | JWT member | — | `200 {items}` oldest first (marks other side read) | `404 CONVERSATION_NOT_FOUND` |
