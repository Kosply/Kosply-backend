"""Persistence-memory: MySQL/MariaDB checkpointer (resume survives restarts).

`DATABASE_URL` set   -> AIOMySQLSaver, tables auto-created via `setup()`.
`DATABASE_URL` empty -> InMemorySaver dev fallback (no resume across restarts).

Driver: `langgraph-checkpoint-mysql[aiomysql]` (the community sibling of
`langgraph-checkpoint-postgres`; supports MariaDB >= 10.7.1).
"""

from collections.abc import Awaitable, Callable
from typing import Any

from app.core.config import mysql_dsn, settings
from app.core.errors import MemoryError

CloseSaver = Callable[..., Awaitable[None]]


async def _noop_close(*_args: Any) -> None:
    """Closer for savers that hold no connection."""
    return None


async def create_saver() -> tuple[Any, CloseSaver]:
    """Create the checkpointer. Returns (saver, aclose)."""
    if settings.database_url:
        try:
            from langgraph.checkpoint.mysql.aio import AIOMySQLSaver
        except ImportError:
            from langgraph_checkpoint_mysql.aio import AIOMySQLSaver
        saver_cm = AIOMySQLSaver.from_conn_string(mysql_dsn(settings.database_url))
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
    """Backend name for readiness output (mysql = durable, memory = degraded)."""
    return "mysql" if type(saver).__name__.endswith("MySQLSaver") else "memory"
