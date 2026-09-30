"""Persistence-memory: Postgres checkpointer (resume survives restarts).

`DATABASE_URL` set   -> PostgresSaver, tables auto-created via `setup()`.
`DATABASE_URL` empty -> InMemorySaver dev fallback (no resume across restarts).
"""

from collections.abc import Awaitable, Callable
from typing import Any

from app.core.config import pg_dsn, settings
from app.core.errors import MemoryError

CloseSaver = Callable[..., Awaitable[None]]


async def _noop_close(*_args: Any) -> None:
    """Closer for savers that hold no connection."""
    return None


async def create_saver() -> tuple[Any, CloseSaver]:
    """Create the checkpointer. Returns (saver, aclose)."""
    if settings.database_url:
        try:
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        except ImportError:
            from langgraph_checkpoint_postgres.aio import AsyncPostgresSaver
        saver_cm = AsyncPostgresSaver.from_conn_string(pg_dsn(settings.database_url))
        saver = await saver_cm.__aenter__()
        try:
            await saver.setup()
        except Exception as exc:
            await saver_cm.__aexit__(None, None, None)
            raise MemoryError(f"checkpointer setup failed: {exc}") from exc
        return saver, saver_cm.__aexit__
    from langgraph.checkpoint.memory import InMemorySaver

    return InMemorySaver(), _noop_close


def describe_saver(saver: Any) -> str:
    """Backend name for readiness output (postgres = durable, memory = degraded)."""
    return "postgres" if type(saver).__name__.endswith("PostgresSaver") else "memory"
