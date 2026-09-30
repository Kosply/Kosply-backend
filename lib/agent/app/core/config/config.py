"""Runtime configuration loaded from the environment.

Resolution order: real env vars > `.env` file > hardcoded defaults.
Mirrors `lib/server/config/env.js` (strict PORT parsing).
"""

import os
from dataclasses import dataclass


def _parse_port(raw: str | None, fallback: int) -> int:
    """Parse PORT strictly: only plain integers 1-65535 are accepted."""
    if raw is None or str(raw).strip() == "":
        return fallback
    text = str(raw).strip()
    if not text.isdigit():
        return fallback
    port = int(text)
    if port < 1 or port > 65535:
        return fallback
    return port


def _load_dotenv(path: str = ".env") -> None:
    """Minimal `.env` loader (no dependency): `KEY=value`, skips blanks/comments."""
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


_load_dotenv()


@dataclass(frozen=True)
class Settings:
    """Validated runtime settings."""

    port: int
    database_url: str | None
    kosply_server_url: str
    ai_model: str
    rate_limit_per_min: int
    max_body_bytes: int
    max_inflight: int
    max_waiters: int
    model_timeout_s: float
    queue_timeout_s: float
    compaction_max_messages: int
    compaction_threshold_pct: float
    compaction_context_total: int
    compaction_keep_recent: int


def _parse_int(raw: str | None, fallback: int) -> int:
    """Parse a positive int env, else the fallback."""
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError, AttributeError):
        return fallback
    return value if value > 0 else fallback


def _parse_float(raw: str | None, fallback: float) -> float:
    """Parse a positive float env, else the fallback."""
    try:
        value = float(str(raw).strip())
    except (TypeError, ValueError, AttributeError):
        return fallback
    return value if value > 0 else fallback


def load_settings() -> Settings:
    """Build settings from the environment."""
    return Settings(
        port=_parse_port(os.getenv("PORT"), 8000),
        database_url=os.getenv("DATABASE_URL") or None,
        kosply_server_url=(os.getenv("KOSPLY_SERVER_URL") or "http://localhost:3000").rstrip("/"),
        ai_model=os.getenv("AI_MODEL") or "openai:gpt-4o-mini",
        rate_limit_per_min=_parse_int(os.getenv("AI_RATE_LIMIT_PER_MIN"), 60),
        max_body_bytes=_parse_int(os.getenv("AI_MAX_BODY_BYTES"), 1_000_000),
        max_inflight=_parse_int(os.getenv("AI_MAX_INFLIGHT"), 50),
        max_waiters=_parse_int(os.getenv("AI_MAX_WAITERS"), 200),
        model_timeout_s=_parse_float(os.getenv("AI_MODEL_TIMEOUT_S"), 120.0),
        queue_timeout_s=_parse_float(os.getenv("AI_QUEUE_TIMEOUT_S"), 5.0),
        compaction_max_messages=_parse_int(os.getenv("AI_COMPACTION_MAX_MESSAGES"), 30),
        compaction_threshold_pct=_parse_float(os.getenv("AI_COMPACTION_THRESHOLD_PCT"), 75.0),
        compaction_context_total=_parse_int(os.getenv("AI_CONTEXT_WINDOW_TOTAL"), 0),
        compaction_keep_recent=_parse_int(os.getenv("AI_COMPACTION_KEEP_RECENT"), 6),
    )


settings = load_settings()
