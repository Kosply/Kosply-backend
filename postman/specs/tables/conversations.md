# conversations (COD) — implemented

One room per buyer per product (`productId` derives the seller — no spoofing).
Strangers get 404 (never a leak).

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/conversations` | JWT | `productId?` (or `sellerId`), optional first `message` | `201 {item}` room with messages, product and both members | `400 VALIDATION`, `404 PRODUCT_NOT_FOUND` / `USER_NOT_FOUND` |
| GET | `/api/conversations` | JWT | — | `200 {items}` inbox, newest activity first (see row shape) | `401` |
| GET | `/api/conversations/:id` | JWT member | — | `200 {item}` + product context and both members | `404 CONVERSATION_NOT_FOUND` |
| POST | `/api/conversations/:id/messages` | JWT member | `type` (TEXT/IMAGE/LOCATION/SYSTEM) + `text` / `imageUrl` / `latitude+longitude` | `201` message (bumps `lastMessageAt`) | `400 VALIDATION`, `404 CONVERSATION_NOT_FOUND` |
| GET | `/api/conversations/:id/messages` | JWT member | — | `200 {items}` oldest first (marks other side read) | `404 CONVERSATION_NOT_FOUND` |

## Inbox row shape

Enough to render a row without loading the thread:

| Field | Value |
|---|---|
| `buyer`, `seller` | public member `{id, username, name, role, universitas, photo}`; the other side is whichever id is not the caller's |
| `product` | `{id, title, price}`, or `null` for a seller chat |
| `lastMessage` | newest message row, or `null` for an empty room |
| `unreadCount` | the caller's unread messages from the other member |
| `_count.messages` | every message in the room (kept for older clients) |
