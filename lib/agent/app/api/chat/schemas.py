"""Chat endpoint schemas: request turns, approvals, answers with callbacks.

Every field is bounded. The previous version accepted a 1 MB
``conversation_id``, a 100 KB ``role`` and an arbitrarily deep ``ui_state``; the
body cap is header-based and therefore trivially bypassed, so a single caller
could pin megabytes per turn in the checkpointer and drive unbounded rows.
"""

from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator, model_validator

from app.agent.listing.card import INT4_MAX, MAX_IMAGES, MAX_PRICE_RP

# `conversation_id` is used as a SQL primary key (`ai_conversations.id`,
# `thread_id`) and as a URL path segment, so it is a cuid/uuid in practice.
ID_MAX = 64
ID_PATTERN = r"^[A-Za-z0-9_-]+$"
MESSAGE_MAX = 4000
UI_STATE_MAX_CHARS = 8000
# Same ceiling as `assertSafeUrl` on the server. A photo is a URL the phone
# already uploaded, not the bytes, so it never rides inside `message`.
IMAGE_URL_MAX = 2048


class ChatRequest(BaseModel):
    """Send one user message (starts or resumes a session by id)."""

    conversation_id: str = Field(
        ...,
        max_length=ID_MAX,
        pattern=ID_PATTERN,
        description="Resume key; reuse the same id to continue a session (maps to ai_conversations.id).",
    )
    user_id: str = Field(..., max_length=ID_MAX, pattern=ID_PATTERN)
    role: str = Field(
        default="UNKNOWN",
        max_length=32,
        pattern=r"^[A-Z_]+$",
        description="Caller role for the persona (BUYER / SELLER); the server sends it from the JWT.",
    )
    message: str = Field(default="", max_length=MESSAGE_MAX)
    ui_state: dict | None = Field(
        default=None,
        description="Flutter screen snapshot (screen, visible ids, selection, filters).",
    )
    # Side photos of one item. The phone sends `imageUrls` (the products
    # column) after it uploads. Capped at 8; a 9th is dropped.
    image_urls: list[str] = Field(default_factory=list)
    price: int | None = Field(
        default=None,
        description="User-supplied rupiah price. The model never fills this.",
    )
    stock: int | None = Field(
        default=None,
        description="User-supplied quantity. Stored as products.stock.",
    )

    @field_validator("image_urls", mode="before")
    @classmethod
    def _image_urls_are_a_list(cls, value):
        """Reject a lone string. Absent means no photos."""
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("image_urls must be an array")
        return value

    @field_validator("image_urls")
    @classmethod
    def _image_urls_are_uploaded(cls, value: list[str]) -> list[str]:
        """Keep http(s) URLs only, then apply the 8-photo card cap."""
        checked: list[str] = []
        for item in value:
            # The card stores at most 8. A 9th photo is ignored, not validated.
            if len(checked) >= MAX_IMAGES:
                break
            if not isinstance(item, str):
                raise ValueError("image_urls must be http(s) URLs")
            url = item.strip()
            if len(url) > IMAGE_URL_MAX:
                raise ValueError("image_urls entry is too long")
            parsed = urlsplit(url)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                raise ValueError("image_urls must be http(s) URLs")
            checked.append(url)
        return checked

    @field_validator("price", mode="before")
    @classmethod
    def _price_is_rupiah(cls, value):
        """Integer rupiah. Bool and float are not a price."""
        return _optional_int(value, "price", 0, MAX_PRICE_RP)

    @field_validator("stock", mode="before")
    @classmethod
    def _stock_is_quantity(cls, value):
        """Integer quantity. This is products.stock, not a new column."""
        return _optional_int(value, "stock", 0, INT4_MAX)

    @model_validator(mode="before")
    @classmethod
    def _image_urls_from_product_column(cls, data):
        """Accept the product column name `imageUrls` as well as `image_urls`."""
        if isinstance(data, dict) and "imageUrls" in data and "image_urls" not in data:
            data = dict(data)
            data["image_urls"] = data.pop("imageUrls")
        return data

    @model_validator(mode="after")
    def _chat_needs_text(self):
        """A chatbot turn still needs text. Photos or price+stock may omit it."""
        completing = self.price is not None and self.stock is not None
        if not self.image_urls and not completing and not self.message.strip():
            raise ValueError("message is required")
        return self

    def check_ui_state(self) -> None:
        """Reject an oversized or pathologically deep `ui_state`.

        The snapshot is written into checkpointed state on every turn, so an
        unbounded one is re-serialised into a new checkpoint each time.
        """
        if self.ui_state is None:
            return
        if len(repr(self.ui_state)) > UI_STATE_MAX_CHARS:
            raise ValueError("ui_state is too large")


def _optional_int(value, field: str, lo: int, hi: int):
    """Parse an optional user integer. Empty means the user did not send it."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"{field} must be an integer")
    if isinstance(value, float) or not isinstance(value, int):
        if isinstance(value, str) and value.strip().lstrip("-").isdigit():
            value = int(value.strip())
        else:
            raise ValueError(f"{field} must be an integer")
    if value < lo or value > hi:
        raise ValueError(f"{field} is out of range")
    return value


class ResumeRequest(BaseModel):
    """Answer a pending human-in-the-loop approval."""

    conversation_id: str = Field(..., max_length=ID_MAX, pattern=ID_PATTERN)
    user_id: str = Field(..., max_length=ID_MAX, pattern=ID_PATTERN)
    approve: bool = Field(..., description="True = run the pending tool, False = reject it.")


class ChatResponse(BaseModel):
    """Final assistant answer for one turn, plus UI callbacks to execute."""

    conversation_id: str
    answer: str
    callbacks: list = Field(
        default_factory=list,
        description="Ordered {callback, args} payloads from perform_callback for Flutter.",
    )
    listing: dict | None = Field(
        default=None,
        description="Product card from a photo listing turn. Absent on a chatbot turn.",
    )


class WaitResponse(BaseModel):
    """Approval-wait outcome: resolved early on event, or timeout with leftovers."""

    conversation_id: str
    status: str = Field(description="resolved | timeout | noop (nothing pending).")
    answer: str = ""
    remainingS: int = Field(default=0, description="Seconds left of the requested budget.")
