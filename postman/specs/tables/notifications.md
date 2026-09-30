# notifications — implemented

Opt-out model: every key enabled unless the user disables it. Disabled
kinds never even hit the table.

| Method | Path | Auth | Body / Query | Success | Errors |
|---|---|---|---|---|---|
| GET | `/api/notifications` | JWT | `unreadOnly?` | `200 {items}` newest first | `401` |
| POST | `/api/notifications/:id/read` | JWT owner | — | `200 {item}` read | `400 VALIDATION` |
| POST | `/api/notifications/read-all` | JWT | — | `200 {count}` | `401` |
| GET | `/api/notifications/preferences` | JWT | — | `200 {items: [{key, enabled}]}` | `401` |
| PATCH | `/api/notifications/preferences` | JWT | `key` (chat/verification/reports/support/product/system), `enabled` | `200 {key, enabled}` | `400 VALIDATION` |

## Emission

| Event | Key | Recipient |
|---|---|---|
| COD message sent | `chat` | the other member |
| Verification approved/rejected | `verification` | applicant |
| Report reviewed | `reports` | reporter |
| Admin support reply | `support` | ticket owner |
