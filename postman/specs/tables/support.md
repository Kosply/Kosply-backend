# support — implemented

`isInternal` notes are admin-only (filtered for reporters).

| Method | Path | Auth | Body / Query | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/support/tickets` | JWT | `category` (default LAINNYA), `subject`, `description` | `201` (`ticketNo KSP-…`) | `400 VALIDATION` |
| GET | `/api/support/tickets` | JWT | `status?`, `category?` (ADMIN filters; users see own) | `200 {items}` | `401` |
| GET | `/api/support/tickets/:id` | JWT owner/ADMIN | — | `200` + messages | `404 TICKET_NOT_FOUND` |
| POST | `/api/support/tickets/:id/messages` | JWT owner/ADMIN | `text`, `imageUrl?`, `isInternal?` (ADMIN only) | `201` (bumps `lastMessageAt`) | `400 VALIDATION`, `404 TICKET_NOT_FOUND` |
| POST | `/api/support/tickets/:id/close` | JWT owner/ADMIN | — | `200` (`CLOSED`) | `404 TICKET_NOT_FOUND` |
