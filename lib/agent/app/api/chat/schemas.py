"""Chat endpoint schemas: request turns, approvals, answers with callbacks.

Every field is bounded. The previous version accepted a 1 MB
``conversation_id``, a 100 KB ``role`` and an arbitrarily deep ``ui_state``; the
body cap is header-based and therefore trivially bypassed, so a single caller
could pin megabytes per turn in the checkpointer and drive unbounded rows.
"""

from pydantic import BaseModel, Field

# `conversation_id` is used as a Postgres primary key (`ai_conversations.id`,
# `thread_id`) and as a URL path segment, so it is a cuid/uuid in practice.
ID_MAX = 64
ID_PATTERN = r"^[A-Za-z0-9_-]+$"
MESSAGE_MAX = 4000
UI_STATE_MAX_CHARS = 8000


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
    message: str = Field(..., min_length=1, max_length=MESSAGE_MAX)
    ui_state: dict | None = Field(
        default=None,
        description="Flutter screen snapshot (screen, visible ids, selection, filters).",
    )

    def check_ui_state(self) -> None:
        """Reject an oversized or pathologically deep `ui_state`.

        The snapshot is written into checkpointed state on every turn, so an
        unbounded one is re-serialised into a new checkpoint each time.
        """
        if self.ui_state is None:
            return
        if len(repr(self.ui_state)) > UI_STATE_MAX_CHARS:
            raise ValueError("ui_state is too large")


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


class WaitResponse(BaseModel):
    """Approval-wait outcome: resolved early on event, or timeout with leftovers."""

    conversation_id: str
    status: str = Field(description="resolved | timeout | noop (nothing pending).")
    answer: str = ""
    remainingS: int = Field(default=0, description="Seconds left of the requested budget.")
