"""History endpoint schemas: stored session messages for resume rendering."""

from pydantic import BaseModel


class HistoryMessage(BaseModel):
    """One stored message (for resume rendering in Flutter)."""

    role: str
    content: str


class HistoryResponse(BaseModel):
    """Full stored history of a session."""

    conversation_id: str
    messages: list[HistoryMessage]
