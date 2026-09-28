# tools — implemented (basic)

Registry: `app/agent/tools/registry.py`. Tools are grouped by function —
`catalog.py` (read-only) vs `contact.py` (sensitive).

| Tool | File | Args | Sensitive | Does (basic) |
|---|---|---|---|---|
| `search_catalog` | `catalog.py` | `query: str` | no | `GET {server}/internal/products/search?q=` → returns matches |
| `get_product_detail` | `catalog.py` | `product_id: str` | no | `GET {server}/internal/products/:id` → price, stock, location, seller |
| `request_seller_contact` | `contact.py` | `product_id: str, message: str` | **yes** | queues a contact request; runs only after approve |

## Rules

| Rule | Notes |
|---|---|
| HTTP only, 10s timeout | tools never touch the DB (monorepo `lib/` rule) |
| Failure mode | `ToolError` → HTTP 500 with message (no silent fallback) |
| Sensitivity flag | `SENSITIVE_TOOLS = {"request_seller_contact"}` in `registry.py` |
| Server TODO | `/internal/*` endpoints don't exist yet — tools report the miss until the server adds them |
