"""Screen moves derived from tool results.

The model searches and drafts. Flutter navigation is not left to a second
tool call: a catalog pick opens that product, and a message draft opens the
chat before the student is asked to approve the send.
"""

import ast
import json


def _payload(content) -> dict:
    """Read a tool result that may be JSON or a Python dict string."""
    if isinstance(content, dict):
        return content
    if not isinstance(content, str):
        return {}
    text = content.strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        try:
            data = ast.literal_eval(text)
        except (ValueError, SyntaxError):
            return {}
    return data if isinstance(data, dict) else {}


def _cheapest_id(payload: dict) -> str:
    """Id of the lowest-priced listing in a search payload."""
    best_id = ""
    best_price = None
    for item in payload.get("items") or []:
        if not isinstance(item, dict):
            continue
        product_id = str(item.get("id") or "").strip()
        if not product_id:
            continue
        price = item.get("price")
        if not isinstance(price, (int, float)) or isinstance(price, bool):
            price = None
        if best_id == "" or (
            price is not None and (best_price is None or price < best_price)
        ):
            best_id = product_id
            best_price = price
    return best_id


def _detail_id(payload: dict) -> str:
    """Product id from a detail payload."""
    item = payload.get("item")
    if not isinstance(item, dict):
        item = payload
    return str(item.get("id") or "").strip()


class TurnNavigation:
    """Remembers the product a turn picked, then emits one screen move."""

    def __init__(self) -> None:
        self._picked = ""
        self._fallback = ""
        self._screen = ""

    def note_message(self, name: str, content) -> None:
        """Record a tool result. A detail call replaces the search fallback."""
        payload = _payload(content)
        if not payload:
            return
        if name == "get_product_detail":
            product_id = _detail_id(payload)
            if product_id:
                self._picked = product_id
            return
        if name == "search_catalog":
            product_id = _cheapest_id(payload)
            if product_id:
                self._fallback = product_id
            return
        if name == "go_to_screen" and payload.get("status") == "ok":
            screen = str(payload.get("screen") or "").strip()
            if screen:
                self._screen = screen

    def note_updates(self, chunk: dict) -> None:
        """Record tool messages inside one graph update chunk."""
        for update in chunk.values():
            messages = update.get("messages", []) if isinstance(update, dict) else []
            for msg in messages:
                if getattr(msg, "type", "") != "tool":
                    continue
                self.note_message(getattr(msg, "name", ""), getattr(msg, "content", ""))

    def callbacks(self, pending=None) -> list:
        """Open the chat when a draft is waiting, otherwise the picked product.

        A message turn lands on the chat, where the preview is approved.
        A search turn lands on the product. The two are not stacked.
        """
        found = []
        for pause in pending or []:
            tools = pause.get("pending_tools") if isinstance(pause, dict) else None
            for tool in tools or []:
                if not isinstance(tool, dict):
                    continue
                args = tool.get("args") if isinstance(tool.get("args"), dict) else {}
                name = tool.get("name")
                if name == "request_seller_contact":
                    target = str(args.get("product_id") or args.get("productId") or "").strip()
                    if target:
                        found.append({"callback": "open_chat", "args": {"productId": target}})
                elif name == "send_chat_message":
                    target = str(
                        args.get("conversation_id") or args.get("conversationId") or ""
                    ).strip()
                    if target:
                        found.append(
                            {"callback": "open_chat", "args": {"conversationId": target}}
                        )
        if not found and self._screen:
            # An explicit screen request wins over a product the turn also saw.
            # Opening both would stack a product on top of the tab they asked for.
            found.append({"callback": "open_screen", "args": {"screen": self._screen}})
        if not found:
            product_id = self._picked or self._fallback
            if product_id:
                found.append({"callback": "open_product", "args": {"productId": product_id}})
        unique = []
        seen = set()
        for item in found:
            key = (item["callback"], json.dumps(item["args"], sort_keys=True))
            if key in seen:
                continue
            seen.add(key)
            unique.append(item)
        return unique
