"""Enforcement: deterministic pre-LLM checks + system-prompt helper."""

from dataclasses import dataclass

from langchain_core.messages import SystemMessage

from ..personas import build_system_prompt
from .rules import (
    EMPTY_MESSAGE,
    INJECTION_PATTERNS,
    MAX_MESSAGE_LEN,
    REJECTION_MESSAGE,
    SYSTEM_PROMPT,
    TOO_LONG_MESSAGE,
)


@dataclass(frozen=True)
class Verdict:
    """Pre-check outcome. `reason` is "" when allowed."""

    allowed: bool
    reason: str = ""


SCOPE_ID = "kosply-scope"


def reply_for(reason: str) -> str:
    """User-facing text for a rejection reason."""
    return {
        "injection": REJECTION_MESSAGE,
        "too_long": TOO_LONG_MESSAGE,
        "empty": EMPTY_MESSAGE,
    }.get(reason, REJECTION_MESSAGE)


def check_user_message(text: str | None) -> Verdict:
    """Reject blanks, overlong input, and injection shapes. Everything else passes."""
    if text is None or not str(text).strip():
        return Verdict(False, "empty")
    body = str(text)
    if len(body) > MAX_MESSAGE_LEN:
        return Verdict(False, "too_long")
    lowered = body.lower()
    for pattern in INJECTION_PATTERNS:
        if pattern.search(lowered):
            return Verdict(False, "injection")
    return Verdict(True, "")


def ensure_system_prompt(messages: list, role: str | None = "UNKNOWN") -> list:
    """Prepend the Kosply scope + role persona once (id-tagged, survives compaction)."""
    if any(getattr(m, "id", "") == SCOPE_ID for m in messages):
        return messages
    return [SystemMessage(content=build_system_prompt(SYSTEM_PROMPT, role), id=SCOPE_ID), *messages]
