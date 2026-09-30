"""Policy layer: scope rules + role personas for the Kosply AI."""

from .personas import BUYER_PERSONA, NEUTRAL_PERSONA, SELLER_PERSONA, build_system_prompt, persona_for
from .scope import (
    EMPTY_MESSAGE,
    INJECTION_PATTERNS,
    MAX_MESSAGE_LEN,
    REJECTION_MESSAGE,
    SCOPE_ID,
    SYSTEM_PROMPT,
    TOO_LONG_MESSAGE,
    Verdict,
    check_user_message,
    ensure_system_prompt,
    reply_for,
)

__all__ = [
    "BUYER_PERSONA",
    "EMPTY_MESSAGE",
    "INJECTION_PATTERNS",
    "MAX_MESSAGE_LEN",
    "NEUTRAL_PERSONA",
    "REJECTION_MESSAGE",
    "SCOPE_ID",
    "SELLER_PERSONA",
    "SYSTEM_PROMPT",
    "TOO_LONG_MESSAGE",
    "Verdict",
    "build_system_prompt",
    "check_user_message",
    "ensure_system_prompt",
    "persona_for",
    "reply_for",
]
