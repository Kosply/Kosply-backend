"""Let the model see side photos that live on the Kosply server itself.

The phone uploads each photo to `POST /api/uploads/images` and gets back a URL
on whatever origin it reached the server on: a LAN address such as
`http://192.168.1.5:3000/uploads/<id>.jpg` in development, the public domain in
production. The listing node used to hand that URL straight to the model as an
`image_url` block, so a hosted model (or a local proxy in front of one) had to
fetch it over the internet. A LAN URL is unreachable from there, the provider
failed the request, and the photo turn produced no card at all.

This module swaps those URLs for inline `data:` URLs just before the model call.
The bytes are read from `KOSPLY_SERVER_URL` -- the agent's own route to the
server -- never from the host in the URL, and only for the exact upload path
shape. A crafted URL therefore cannot make the agent fetch an arbitrary host
(the SSRF the agent is otherwise careful to avoid), and any other URL is passed
through untouched for the model to fetch as before.

The checkpointed messages keep the short URLs; only the copy sent to the model
carries the bytes, so the thread history does not grow by megabytes per turn.
"""

import base64
import re
from urllib.parse import urlsplit

import httpx
from langchain_core.messages import BaseMessage, HumanMessage

from app.core.config import settings

# Exactly what upload.service.js produces: a cuid2 name and one of three types.
UPLOAD_PATH = re.compile(r"^/uploads/[a-z0-9]{8,64}\.(jpg|png|webp)$")

CONTENT_TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}

# Same ceiling the upload route enforces.
MAX_PHOTO_BYTES = 8 * 1024 * 1024

FETCH_TIMEOUT_S = 10.0


def own_upload_path(url: str) -> str | None:
    """Return the upload path when `url` points at a Kosply upload, else None."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or parts.query or parts.fragment:
        return None
    return parts.path if UPLOAD_PATH.match(parts.path) else None


async def _fetch_data_url(client: httpx.AsyncClient, path: str) -> str | None:
    """Read one upload from the server and encode it, or None on any failure."""
    try:
        res = await client.get(f"{settings.kosply_server_url}{path}", timeout=FETCH_TIMEOUT_S)
    except httpx.HTTPError:
        return None
    if res.status_code != 200 or not res.content or len(res.content) > MAX_PHOTO_BYTES:
        return None
    # The extension, not the response header, decides the type: the path was
    # already matched against the three types the server stores.
    content_type = CONTENT_TYPES[path.rsplit(".", 1)[1]]
    return f"data:{content_type};base64,{base64.b64encode(res.content).decode('ascii')}"


async def inline_own_uploads(
    messages: list[BaseMessage],
    *,
    client: httpx.AsyncClient | None = None,
) -> list[BaseMessage]:
    """Copy `messages`, inlining every image block that is a Kosply upload.

    A photo that cannot be fetched keeps its URL, so a public deployment still
    works through the provider's own fetch exactly as it did before.
    """
    owns_client = client is None
    http = client or httpx.AsyncClient()
    try:
        out: list[BaseMessage] = []
        for message in messages:
            if not isinstance(message, HumanMessage) or not isinstance(message.content, list):
                out.append(message)
                continue
            blocks = []
            for block in message.content:
                url = (
                    block.get("image_url", {}).get("url")
                    if isinstance(block, dict) and block.get("type") == "image_url"
                    else None
                )
                path = own_upload_path(url) if isinstance(url, str) else None
                inline = await _fetch_data_url(http, path) if path else None
                blocks.append({"type": "image_url", "image_url": {"url": inline}} if inline else block)
            out.append(message.model_copy(update={"content": blocks}))
        return out
    finally:
        if owns_client:
            await http.aclose()
