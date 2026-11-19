"""aiomysql must still escape checkpoint blobs after PyMySQL 1.2.3."""

import aiomysql.connection as connection

from app.agent.memory.checkpoint.checkpointer import _repair_aiomysql_bytes_escape


def test_bytes_escape_is_hex():
    """A bytes parameter is hex-escaped, not called as the PyMySQL sentinel string."""
    connection.escape_bytes_prefixed = "DO NOT IMPORT THIS!!!"
    _repair_aiomysql_bytes_escape()
    escape = connection.escape_bytes_prefixed
    assert callable(escape)
    assert escape(b"\x00'") == "_binary X'0027'"
