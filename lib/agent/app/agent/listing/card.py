"""Assemble one product card from side photos and a model caption.

The card uses the public `products` columns (`title`, `description`,
`category`, `imageUrls`, `price`, `stock`). Quantity is `stock`. There is
no `quantity` column. The backend has no camera and no binary upload: the
phone takes the photos, uploads them the same way a listing already does,
and hands this function the resulting `http(s)` URLs.

Limits are the ones a later product write can actually store:
- `title` VARCHAR(191) in the init migration (the service allows 200, which
  does not fit the column, so the card uses 191)
- `description` 20000 (product write; the column is TEXT)
- `category` 100. The prompt asks for one seeded name. The assembler
  still accepts any non-empty string; the product write checks the catalog.
- `imageUrls` at most 8 (product write). A 9th photo is dropped, not stored.
- `price` integer rupiah, 0 .. 2_000_000_000
- `stock` integer, 0 .. int4 max

`price` and `stock` stay unset until the caller passes the user's integers.
Numbers inside the model text are ignored.
"""

import json
import re

TITLE_MAX = 191
DESCRIPTION_MAX = 20_000
CATEGORY_MAX = 100
MAX_IMAGES = 8
MAX_PRICE_RP = 2_000_000_000
INT4_MAX = 2_147_483_647

# Read by the model, not shown to the user. English matches the other prompts.
LISTING_PROMPT = """You fill one Kosply product card from photos of a single second-hand item.
The photos are different sides of that one item. The seller wrote the caption. It has two lines:
Nama barang: the name the seller chose
Kondisi barang: what the seller says about wear, flaws, and what is missing
A later line may say Daftar kategori: followed by the only category names you may use.
Reply with one JSON object and nothing else:
{"title":"...","description":"...","category":"..."}
Rules:
- title, description, and category are required and must be non-empty.
- title is the seller's Nama barang, trimmed, at most 80 characters. Do not rename it, translate it, or add words.
- description is Indonesian sales text for a second-hand item. Write exactly two paragraphs, separated by one blank line. The whole description is 80 to 140 words.
- Paragraph one says what the item is, then color, material, shape, and any logo or printed words you can actually read. Do not judge the condition there.
- Paragraph two is the condition, and only the condition. It starts with "Kondisi:". Quality and flaws are one account, not two sections. The seller's Kondisi barang is that whole account. Write what is still good and what is lacking together, in the seller's words, and add a flaw that is clearly visible in the photos. Do not use the headings "Kualitas" or "Kekurangan". Do not invent a flaw, a size, a price, or a history the seller and the photos do not show. If the seller says the item is fine and the photos show no flaw, say the condition is utuh and mention only what is actually in the frame.
- category is exactly one name from the Daftar kategori line. If that line is missing or none of the names fit, use "Lainnya".
- Do not include price, stock, or quantity. The seller types those.
- Do not include location, status, or a seller id.
"""

_JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)


class ListingCardError(ValueError):
    """The model output cannot become a product card."""


def cap_image_urls(photos) -> list[str]:
    """Keep the first 8 photo URLs. A 9th entry is not stored."""
    kept: list[str] = []
    for item in photos or []:
        if not isinstance(item, str):
            continue
        url = item.strip()
        if not url:
            continue
        kept.append(url)
        if len(kept) >= MAX_IMAGES:
            break
    return kept


def listing_message_content(text: str, photos: list[str]) -> list[dict]:
    """Model content blocks: caption text, then one image block per photo.

    Photos are not concatenated into the caption, so the chatbot's
    4000-character message cap does not apply to them.
    """
    caption = (text or "").strip() or "Foto sisi barang yang akan dijual."
    blocks: list[dict] = [{"type": "text", "text": caption}]
    for url in cap_image_urls(photos):
        blocks.append({"type": "image_url", "image_url": {"url": url}})
    return blocks


def message_text(content) -> str:
    """Flatten a model reply (string or content blocks) to text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                if block.get("type") in ("text", "output_text"):
                    parts.append(str(block.get("text") or ""))
        return "\n".join(parts)
    return "" if content is None else str(content)


def assemble_listing_card(
    photos,
    model_text=None,
    *,
    price=None,
    stock=None,
    previous: dict | None = None,
) -> dict:
    """Build one card.

    `photos` plus `model_text` fill `title`, `description`, `category`, and
    `imageUrls`. `price` and `stock` are set only from the explicit user
    arguments. Pass `previous` when the user is adding those two integers to
    a card the model already filled.
    """
    images = cap_image_urls(photos)
    fresh = model_text is not None and str(model_text).strip() != ""
    if fresh:
        title, description, category = _fields_from_model(str(model_text))
    elif previous:
        title = _bounded_text(previous.get("title"), "title", TITLE_MAX)
        description = _bounded_text(previous.get("description"), "description", DESCRIPTION_MAX)
        category = _bounded_text(previous.get("category"), "category", CATEGORY_MAX)
        if not images:
            images = cap_image_urls(previous.get("imageUrls") or [])
    else:
        raise ListingCardError("listing card is empty")
    if not images:
        raise ListingCardError("listing card needs at least one photo")

    card = {
        "title": title,
        "description": description,
        "category": category,
        "imageUrls": images,
        "price": None if fresh or not previous else previous.get("price"),
        "stock": None if fresh or not previous else previous.get("stock"),
    }
    if price is not None:
        card["price"] = _user_int(price, "price", 0, MAX_PRICE_RP)
    if stock is not None:
        card["stock"] = _user_int(stock, "stock", 0, INT4_MAX)
    return card


def _fields_from_model(model_text: str) -> tuple[str, str, str]:
    """Read title, description, and category. Ignore price and stock."""
    data = _extract_object(model_text)
    return (
        _bounded_text(data.get("title"), "title", TITLE_MAX),
        _bounded_text(data.get("description"), "description", DESCRIPTION_MAX),
        _bounded_text(data.get("category"), "category", CATEGORY_MAX),
    )


def _extract_object(model_text: str) -> dict:
    """Pull the JSON object out of a raw reply or a fenced block."""
    raw = model_text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, re.DOTALL)
    if fenced:
        raw = fenced.group(1)
    else:
        found = _JSON_OBJECT.search(raw)
        if found:
            raw = found.group(0)
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ListingCardError("listing card is empty") from exc
    if not isinstance(data, dict):
        raise ListingCardError("listing card is empty")
    return data


def _bounded_text(value, field: str, limit: int) -> str:
    """Trim, require non-empty, and clip to the product write limit."""
    if not isinstance(value, str):
        raise ListingCardError("listing card is empty")
    text = value.strip()
    if not text:
        raise ListingCardError("listing card is empty")
    if len(text) > limit:
        text = text[:limit].rstrip()
    if not text:
        raise ListingCardError("listing card is empty")
    return text


def _user_int(value, field: str, lo: int, hi: int) -> int:
    """Accept a user integer. Reject bools and floats (bool is a subclass of int)."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ListingCardError(f"{field} must be an integer")
    if value < lo or value > hi:
        raise ListingCardError(f"{field} is out of range")
    return value
