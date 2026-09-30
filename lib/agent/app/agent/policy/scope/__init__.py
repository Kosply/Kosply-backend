"""Scope policy package: prompt text, rules, enforcement."""

from .guard import SCOPE_ID, Verdict, check_user_message, ensure_system_prompt, reply_for
from .rules import (
    EMPTY_MESSAGE,
    INJECTION_PATTERNS,
    MAX_MESSAGE_LEN,
    REJECTION_MESSAGE,
    SYSTEM_PROMPT,
    TOO_LONG_MESSAGE,
)

__all__ = [
    "EMPTY_MESSAGE",
    "INJECTION_PATTERNS",
    "MAX_MESSAGE_LEN",
    "REJECTION_MESSAGE",
    "SCOPE_ID",
    "SYSTEM_PROMPT",
    "TOO_LONG_MESSAGE",
    "Verdict",
    "check_user_message",
    "ensure_system_prompt",
    "reply_for",
]
