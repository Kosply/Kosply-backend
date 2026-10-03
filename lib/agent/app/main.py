"""Kosply AI agent entrypoint: FastAPI app + lifespan (memory setup, graph compile)."""

from contextlib import asynccontextmanager

import os

import uvicorn
from fastapi import FastAPI

from app.agent.graph import build_graph
from app.agent.memory import create_saver
from app.api import router
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.limits import RateLimiter, BodyCapMiddleware, rate_limit_middleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Boot: setup checkpointer tables, compile the graph once, share via app.state."""
    import asyncio

    saver, close_saver = await create_saver()
    try:
        from app.agent.models import resolve_context_total

        total = resolve_context_total(
            settings.ai_model,
            explicit=settings.compaction_context_total,
            base_url=os.getenv("OPENAI_BASE_URL", ""),
            api_key=os.getenv("OPENAI_API_KEY", ""),
        )
        print(f"[agent] context window: {total} tokens "
              f"(threshold {settings.compaction_threshold_pct}%)")
        app.state.graph = build_graph(
            checkpointer=saver,
            model_name=settings.ai_model,
            compaction_max_messages=settings.compaction_max_messages,
            compaction_threshold_pct=settings.compaction_threshold_pct,
            compaction_context_total=total,
            compaction_keep_recent=settings.compaction_keep_recent,
        )
        app.state.saver = saver
        # A small pool for the ownership check in api/shared.assert_thread_ownership.
        # `history_store` opened a fresh connection per statement (3 per turn,
        # plus one per /readyz and per /ai/history call) against a database whose
        # max_connections is shared with Prisma, so overlapping turns could
        # starve every connection in the system.
        app.state.db = None
        if settings.database_url:
            try:
                from psycopg_pool import AsyncConnectionPool

                # `pg_dsn` is exported from the app.core.config PACKAGE. An
                # earlier version imported it from `app.core.config.dsn`, which
                # exists, but a sibling module had imported it from
                # history_store (where it is only a local import) - the
                # resulting ImportError was swallowed below, `app.state.db`
                # stayed None, and the ownership check was skipped on every
                # request in every deployment.
                from app.core.config import pg_dsn

                pool = AsyncConnectionPool(
                    pg_dsn(settings.database_url), min_size=1, max_size=8
                )
                await pool.open(wait=True, timeout=10.0)
                app.state.db = pool
                print("[agent] ownership pool ready")
            except Exception as exc:  # pragma: no cover - boot degradation
                # Loud, because a missing pool means the ownership check is
                # inert. The server still checks ownership in Prisma first, so
                # this is defence in depth rather than the only barrier.
                print(
                    f"[agent] WARNING ownership pool unavailable "
                    f"({exc!r}); /ai/* ownership is NOT enforced by the agent"
                )
        app.state.inflight = asyncio.Semaphore(settings.max_inflight)
        # Long approval waits are cheap (no model call) but must stay bounded
        # so a burst of phones cannot pin an unbounded number of coroutines.
        app.state.waiters = asyncio.Semaphore(settings.max_waiters)
        yield
    finally:
        pool = getattr(app.state, "db", None)
        if pool is not None:
            try:
                await pool.close()
            except Exception:
                pass
        await close_saver(None, None, None)


# Docs/OpenAPI were served unauthenticated on a public port, handing an attacker
# a complete map of the API for free. Disabled unless explicitly enabled.
app = FastAPI(
    title="kosply-agent",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None if os.getenv("AI_ENABLE_DOCS") == "1" else None,
    redoc_url=None,
    openapi_url=None if os.getenv("AI_ENABLE_DOCS") == "1" else None,
)
register_exception_handlers(app)
# `add_middleware` (and the `middleware("http")` decorator, which calls it)
# INSERTS AT INDEX 0, so the middleware added LAST ends up OUTERMOST. The rate
# limiter reads the entire body with `await request.body()`, so the body cap
# MUST be registered last in order to sit in front of it: with the reverse
# order the limiter buffered a complete 8 MB chunked upload before the 1 MB cap
# ever saw a byte, which is the exact amplification the cap exists to prevent.
app.middleware("http")(
    rate_limit_middleware(RateLimiter(settings.rate_limit_per_min))
)
app.add_middleware(BodyCapMiddleware, max_bytes=settings.max_body_bytes)
app.include_router(router)


@app.get("/")
async def root() -> dict:
    """Root info for load-balancer checks."""
    return {"name": "kosply-agent", "status": "ok"}


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port)
