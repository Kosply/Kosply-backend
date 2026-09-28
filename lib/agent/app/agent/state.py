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
