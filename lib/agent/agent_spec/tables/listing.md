# listing — implemented

Photo listing mode beside the chatbot. The phone takes side photos, uploads
them the same way a product already does (this server has no camera and no
binary upload), then hands the resulting `http(s)` URLs to one chat turn.
The model fills one product card. The seller types only the price and the
quantity.

Files: `app/agent/listing/card.py` (pure card), `app/api/chat/turn.py`
(shared by JSON and SSE), `app/agent/graph.py` (`listing` and `listing_price`
nodes). The Kosply server forwards the same body from
`lib/server/services/ai/ai.service.js` (`buildTurnBody`).

No `products` row is inserted. No new column. Quantity is the existing
`stock` column.

## Modes

`listing_mode` is set on every turn, so a previous turn cannot stick.

| `listing_mode` | When | Graph node |
|---|---|---|
| `photos` | this turn has side-photo URLs (wins over price) | `listing` |
| `price` | this turn has both `price` and `stock`, and a card already exists | `listing_price` |
| `chat` | anything else | `agent` (unchanged chatbot) |

## Request

`POST /ai/chat` and `POST /ai/chat/stream`. `imageUrls` is the products
column name; `image_urls` is accepted too.

| Field | Rule |
|---|---|
| `message` | required for a chatbot turn, max 4000 characters. Optional when the turn has photos, or both `price` and `stock`. A caption is still screened for injection. |
| `imageUrls` | array of `http`/`https` URLs, each at most 2048 characters. At most 8 are kept. A 9th is dropped, not stored. `data:` URLs are rejected. |
| `price` | integer rupiah, `0 .. 2_000_000_000`. Absent means unset. Bool and float are rejected. |
| `stock` | integer quantity, `0 .. 2147483647`. Absent means unset. |

Photos are image blocks beside the caption. They are not concatenated into
`message`, so the 4000-character text cap does not reject them.

## Card

Returned as `listing` on `POST /ai/chat`. Omitted on a chatbot turn.
The SSE `done` event carries the same object when this turn produced one.

| Field | Who fills it | Limit |
|---|---|---|
| `title` | model | 191 characters (`products.title` is `VARCHAR(191)`) |
| `description` | model | 20000 characters |
| `category` | model, free text, not an enum | 100 characters |
| `imageUrls` | the uploaded URLs, cover is `[0]` | 8 |
| `price` | the user, on the follow-up turn | integer rupiah, or `null` |
| `stock` | the user, on the follow-up turn | integer, or `null` |

The model is told to return JSON `{"title","description","category"}` only.
A price or stock inside that JSON is ignored. The photo turn leaves `price`
and `stock` null even if the body also sent them. The next turn that sends
only those two integers keeps the AI text and the photo list.

The card does not include `sellerId`, location, or `status`.

## Model input

The `listing` node calls the unbound model (no tools) with `LISTING_PROMPT`
plus the caption and one `image_url` block per kept photo. The answer shown
to the user is the title and description, not the raw JSON. An empty card
fails the turn.

`listing_price` does not call the model. It writes the user's integers onto
the checkpointed card.

## Own uploads reach the model as bytes

The phone uploads each side photo to `POST /api/uploads/images`, which answers
with a URL on the origin the phone used — a LAN address in development. A hosted
model cannot fetch that, so `app/agent/listing/photos.py` swaps those blocks for
`data:` URLs on the copy sent to the model.

| Rule | Detail |
|---|---|
| Which URLs | path is exactly `/uploads/<cuid2>.jpg\|png\|webp`, no query or fragment, any host |
| Fetched from | `KOSPLY_SERVER_URL` + that path, never the URL's own host (no SSRF) |
| Size cap | 8 MB, same as the upload route |
| On failure | the block keeps its URL, so a public deployment still works as before |
| Checkpoint | keeps the short URLs; only the model call carries the bytes |
