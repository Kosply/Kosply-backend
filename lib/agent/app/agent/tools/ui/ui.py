"""UI bridge tools: read what Flutter shows, emit callbacks Flutter executes.

Protocol (Flutter contract):
1. Flutter sends `ui_state` every turn: screen, visible ids, selection, filters.
2. Model calls `read_ui_state` to see it, `list_catalog` to browse items.
3. Model calls `perform_callback` with a SAFE callback; the turn response
   carries `callbacks[]`, Flutter executes them and renders the result.
4. Anything risky (contact seller, buy, delete) stays in sensitive tools
   behind human approval — never in callbacks.
"""

import json
from typing import Annotated

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

#: Callbacks Flutter implements. Unknown names are refused (ask the user).
SAFE_CALLBACKS = frozenset({
    "open_product",
    "show_product",
    "apply_filter",
    "clear_filter",
    "scroll_to",
    "highlight",
    "show_toast",
    "open_chat",
    "focus_input",
    "open_screen",
})


def _snapshot(state) -> dict:
    """Latest UI snapshot from graph state (empty when Flutter sends none)."""
    snap = (state or {}).get("ui_state") or {}
    return snap if isinstance(snap, dict) else {}


@tool
def read_ui_state(query: str = "",
                  state: Annotated[dict, InjectedState()] = None) -> str:
    """Read the current Flutter screen (snapshot sent with this turn).

    Use it to answer "what am I looking at" and to ground actions.
    Optional query filters snapshot keys by substring.
    """
    snap = _snapshot(state)
    if not snap:
        return "No UI state attached to this turn."
    if not query:
        return json.dumps(snap, ensure_ascii=False)
    lowered = query.lower()
    matched = {k: v for k, v in snap.items() if lowered in str(k).lower()}
    return json.dumps(matched or snap, ensure_ascii=False)


@tool
def perform_callback(callback: str, params: dict | None = None) -> str:
    """Ask Flutter to run one UI callback. Returns the executed payload.

    Only SAFE_CALLBACKS run; anything else (buy, delete, contact) must go
    through the sensitive approval tools instead. The Flutter-facing payload
    always uses the `args` key (the tool-side `params` name is a langchain
    internal collision workaround, invisible to callers).
    """
    name = str(callback or "").strip()
    if name not in SAFE_CALLBACKS:
        return ("Unknown callback. Tell the user which safe action you need "
                "(open_product, apply_filter, open_chat, ...) and ask them to confirm.")
    return json.dumps({"callback": name, "args": params or {}}, ensure_ascii=False)
