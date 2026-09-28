"""Pydantic request/response schemas for the agent HTTP API."""

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    """Send one user message (starts or resumes a session by id)."""

    conversation_id: str = Field(
        ...,
        description="Resume key; reuse the same id to continue a session (maps to ai_conversations.id).",
    )
    user_id: str
    message: str


class ResumeRequest(BaseModel):
    """Answer a pending human-in-the-loop approval."""

    conversation_id: str
    user_id: str
    approve: bool = Field(..., description="True = run the pending tool, False = reject it.")


class ChatResponse(BaseModel):
    """Final assistant answer for one turn."""

    conversation_id: str
    answer: str


class HistoryMessage(BaseModel):
    """One stored message (for resume rendering in Flutter)."""

    role: str
    content: str


class HistoryResponse(BaseModel):
    """Full stored history of a session."""

    conversation_id: str
    messages: list[HistoryMessage]
