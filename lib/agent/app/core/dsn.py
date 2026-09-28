"""DSN helpers: Prisma-style URLs vs raw drivers.

Prisma accepts `?schema=public`; raw drivers (`psycopg`, checkpointer)
reject unknown query params. Strip Prisma-only params here so one
`DATABASE_URL` works everywhere.
"""

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_PRISMA_ONLY_PARAMS = frozenset({"schema"})


def pg_dsn(raw: str) -> str:
    """Return a psycopg-safe DSN by dropping Prisma-only query params."""
    parts = urlsplit(raw)
    if not parts.query:
        return raw
    kept = [(k, v) for k, v in parse_qsl(parts.query) if k not in _PRISMA_ONLY_PARAMS]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment))
