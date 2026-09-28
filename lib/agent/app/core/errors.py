"""Error hierarchy + FastAPI handlers (one place, easy to manage).

All agent errors funnel through `AgentError`. `ApprovalRequired` is
special: it becomes HTTP 409 carrying the interrupt payload so Flutter
can show approve/reject for the pending tool action.
"""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class AgentError(Exception):
    """Base agent error (default: HTTP 500)."""

    status_code: int = 500

    def __init__(self, message: str, *, details: Any = None) -> None:
        """Store the message plus optional machine-readable details."""
        super().__init__(message)
        self.message = message
        self.details = details


class ModelError(AgentError):
    """LLM call failed (missing key, provider down, bad model id)."""


class ToolError(AgentError):
    """A tool (catalog / internal API) call failed."""


class MemoryError(AgentError):
    """Checkpointer unavailable (persistence down)."""


class ApprovalRequired(AgentError):
    """Human-in-the-loop: a sensitive tool needs approve/reject (HTTP 409)."""

    status_code: int = 409

    def __init__(self, interrupt_payload: Any) -> None:
        """Wrap the interrupt payload for the 409 approval response."""
        super().__init__("approval required", details=interrupt_payload)


def register_exception_handlers(app: FastAPI) -> None:
    """Map the hierarchy to JSON responses."""

    @app.exception_handler(AgentError)
    async def _handle_agent_error(_request: Request, exc: AgentError) -> JSONResponse:
        """Render approval pauses as 409, everything else as its status code."""
        if isinstance(exc, ApprovalRequired):
            return JSONResponse(
                status_code=409,
                content={"status": "needs_approval", "interrupt": exc.details},
            )
        return JSONResponse(
            status_code=exc.status_code,
            content={"status": "error", "message": exc.message},
        )
