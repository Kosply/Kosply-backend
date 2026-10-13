"""DSN helpers: Prisma-style URLs vs raw drivers.

Prisma accepts `?schema=public`, `?connection_limit=12` and friends; raw
drivers (`aiomysql`, `pymysql`, the checkpointer's parser) either reject
unknown query params or silently ignore them. Strip Prisma-only params here so
one `DATABASE_URL` works everywhere.

`mysql_conn_kwargs` exists because aiomysql/pymysql take keyword arguments, not
a URL: the same `DATABASE_URL` feeds `aiomysql.create_pool(...)`, a one-shot
`pymysql.connect(...)` in tests, and the checkpointer (which parses a URL).
"""

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Params only Prisma understands. `unix_socket` is kept: the MySQL checkpointer
# reads it out of the query string to support socket connections.
_PRISMA_ONLY_PARAMS = frozenset({"schema", "connection_limit", "pool_timeout", "connect_timeout"})


def mysql_dsn(raw: str) -> str:
    """Return a MySQL-driver-safe DSN by dropping Prisma-only query params.

    A literal `localhost` host is rewritten to `127.0.0.1` (unless the URL asks
    for a unix socket): pymysql/aiomysql treat "localhost" as "use the default
    socket path", and MariaDB is published on TCP only, so a DSN that works for
    the Node server (mysql2 dials TCP) would fail with "Can't connect to MySQL
    server on 'localhost'" here.
    """
    parts = urlsplit(raw)
    params = dict(parse_qsl(parts.query)) if parts.query else {}
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query) if k not in _PRISMA_ONLY_PARAMS])
    netloc = parts.netloc
    if parts.hostname == "localhost" and not params.get("unix_socket"):
        userinfo, _, hostport = netloc.rpartition("@")
        netloc = (f"{userinfo}@" if userinfo else "") + hostport.replace("localhost", "127.0.0.1", 1)
    if not query and not params.get("unix_socket") and netloc == parts.netloc:
        return raw
    return urlunsplit((parts.scheme, netloc, parts.path, query, parts.fragment))


def mysql_conn_kwargs(raw: str) -> dict:
    """Parse a `mysql://` URL into kwargs for `aiomysql.connect`/`pymysql.connect`.

    Same `localhost` rule as `mysql_dsn`: without a `unix_socket` param the
    host becomes `127.0.0.1` so the driver dials TCP instead of a socket that
    does not exist on the host.

    Raises ValueError on an empty URL so callers keep their own guard.
    """
    if not raw:
        raise ValueError("empty database URL")
    parts = urlsplit(raw)
    params = dict(parse_qsl(parts.query))
    kwargs = {
        "host": parts.hostname or "localhost",
        "port": parts.port or 3306,
        "user": parts.username or "",
        "password": parts.password or "",
        "db": parts.path.lstrip("/") or None,
    }
    if params.get("unix_socket"):
        kwargs["unix_socket"] = params["unix_socket"]
    elif kwargs["host"] == "localhost":
        kwargs["host"] = "127.0.0.1"
    return kwargs
