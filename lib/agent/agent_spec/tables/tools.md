# tools — implemented (basic)

Registry: `app/agent/tools/` — one file per function: `catalog.py`
(read-only + filters), `contact.py` (sensitive), `roles.py` (plain),
`ui.py` (screen + callbacks), `chat.py` (negotiation).

| Tool | File | Args | Sensitive | Does (basic) |
|---|---|---|---|---|
| `search_catalog` | `catalog.py` | `query, max_price?, category?` | no | `GET {server}/api/internal/products/search?q=` + tool-side filters |
| `get_product_detail` | `catalog.py` | `product_id: str` | no | `GET {server}/api/internal/products/:id` → price, stock, location, seller |
| `get_user_role` | `roles.py` | `user_id: str` | no | `GET {server}/api/internal/users/:id` → role from `item.role` |
| `request_seller_contact` | `contact.py` | `product_id: str, message: str` (+ injected state) | **yes** | `POST {server}/api/internal/contact-requests` with buyer from state; runs only after approve |
| `read_conversation` | `chat.py` | `conversation_id: str` | no | `GET {server}/api/internal/conversations/:id/messages` → history for nego context |
| `send_chat_message` | `chat.py` | `conversation_id: str, text: str` (+ injected state) | **yes** | `POST {server}/api/internal/conversations/:id/messages` as the state user; runs only after approve |

## Rules

| Rule | Notes |
|---|---|
| HTTP only, 10s timeout | tools never touch the DB (monorepo `lib/` rule) |
| Failure mode | `ToolError` → HTTP 500 with message (no silent fallback) |
| Sensitivity flag | `SENSITIVE_TOOLS = {"request_seller_contact", "send_chat_message"}` in `registry.py` |
| State injection | contact/nego tools read `user_id` from graph state (`InjectedState`) — the model never invents it |
