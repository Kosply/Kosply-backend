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


def _repair_aiomysql_bytes_escape() -> None:
    """Keep checkpoint blobs writable on the PyMySQL that aiomysql 0.3.2 ships with.

    PyMySQL 1.2.3 turned ``escape_bytes_prefixed`` into the sentinel string
    ``"DO NOT IMPORT THIS!!!"``. aiomysql 0.3.2 still calls that name for a
    ``bytes`` parameter. LangGraph writes each checkpoint as bytes, so every
    photo turn died with ``'str' object is not callable`` after the model had
    already answered. aiomysql 0.3.3 (not released yet) inlines this same hex
    escape. Drop the repair once that release is installed.
    """
    import aiomysql.connection as connection

    if callable(getattr(connection, "escape_bytes_prefixed", None)):
        return

    def escape_bytes(value: bytes) -> str:
        return "_binary X'%s'" % value.hex()

    connection.escape_bytes_prefixed = escape_bytes


_repair_aiomysql_bytes_escape()


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
