"""Error hierarchy package: one place for agent failures + HTTP mapping."""

from .errors import (
    AgentError,
    ApprovalRequired,
    MemoryError,
    ModelError,
    ModelTimeout,
    ServerBusy,
    ToolError,
    register_exception_handlers,
)

__all__ = [
    "AgentError",
    "ApprovalRequired",
    "MemoryError",
    "ModelError",
    "ModelTimeout",
    "ServerBusy",
    "ToolError",
    "register_exception_handlers",
]
