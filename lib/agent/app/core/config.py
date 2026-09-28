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


def load_settings() -> Settings:
    """Build settings from the environment."""
    return Settings(
        port=_parse_port(os.getenv("PORT"), 8000),
        database_url=os.getenv("DATABASE_URL") or None,
        kosply_server_url=(os.getenv("KOSPLY_SERVER_URL") or "http://localhost:3000").rstrip("/"),
        ai_model=os.getenv("AI_MODEL") or "openai:gpt-4o-mini",
    )


settings = load_settings()
