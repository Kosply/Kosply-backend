"""Chat endpoint schemas: request turns, approvals, answers with callbacks."""

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    """Send one user message (starts or resumes a session by id)."""

    conversation_id: str = Field(
        ...,
        description="Resume key; reuse the same id to continue a session (maps to ai_conversations.id).",
    )
    user_id: str
    role: str = Field(
        default="UNKNOWN",
        description="Caller role for the persona (BUYER / SELLER); Flutter sends it from login.",
    )
    message: str
    ui_state: dict | None = Field(
        default=None,
        description="Flutter screen snapshot (screen, visible ids, selection, filters).",
    )


class ResumeRequest(BaseModel):
    """Answer a pending human-in-the-loop approval."""

    conversation_id: str
    user_id: str
    approve: bool = Field(..., description="True = run the pending tool, False = reject it.")


class ChatResponse(BaseModel):
    """Final assistant answer for one turn, plus UI callbacks to execute."""

    conversation_id: str
    answer: str
    callbacks: list = Field(
        default_factory=list,
        description="Ordered {callback, args} payloads from perform_callback for Flutter.",
    )


class WaitResponse(BaseModel):
    """Approval-wait outcome: resolved early on event, or timeout with leftovers."""

    conversation_id: str
    status: str = Field(description="resolved | timeout | noop (nothing pending).")
    answer: str = ""
    remainingS: int = Field(default=0, description="Seconds left of the requested budget.")
