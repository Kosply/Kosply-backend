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
from app.core.limits import RateLimiter, body_cap_middleware, rate_limit_middleware


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
        app.state.inflight = asyncio.Semaphore(settings.max_inflight)
        yield
    finally:
        await close_saver(None, None, None)


app = FastAPI(title="kosply-agent", version="0.1.0", lifespan=lifespan)
register_exception_handlers(app)
# Registered rate-limit first so the body cap below runs outermost (LIFO):
# oversized bodies are rejected before any rate accounting happens.
app.middleware("http")(
    rate_limit_middleware(RateLimiter(settings.rate_limit_per_min))
)
app.middleware("http")(body_cap_middleware(settings.max_body_bytes))
app.include_router(router)


@app.get("/")
async def root() -> dict:
    """Root info for load-balancer checks."""
    return {"name": "kosply-agent", "status": "ok"}


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port)
