"""Agent state: LangGraph MessagesState plus Kosply fields.

Uses `MessagesState` (reference: langgraph.graph.message) so message
history gets the `add_messages` reducer for free — this is what makes
resume work together with the checkpointer.
"""

from langgraph.graph import MessagesState


class AgentState(MessagesState, total=False):
    """State carried through the graph (extra keys optional for callers)."""

    user_id: str
    user_role: str
    ui_state: dict
    # "chat" keeps the existing agent. "photos" fills one listing card.
    # "price" writes the user's price and stock onto that card.
    listing_mode: str
    image_urls: list
    listing_price: int
    listing_stock: int
    listing_card: dict
