"""Kosply AI agent entrypoint: FastAPI app + lifespan (memory setup, graph compile)."""

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from app.agent.graph import build_graph
from app.agent.memory import create_saver
from app.api.routes import router
from app.core.caps import body_cap_middleware
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.ratelimit import RateLimiter, rate_limit_middleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Boot: setup checkpointer tables, compile the graph once, share via app.state."""
    import asyncio

    saver, close_saver = await create_saver()
    try:
        app.state.graph = build_graph(checkpointer=saver, model_name=settings.ai_model)
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
