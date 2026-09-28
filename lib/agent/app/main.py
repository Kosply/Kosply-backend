"""Kosply AI agent entrypoint: FastAPI app + lifespan (memory setup, graph compile)."""

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from app.agent.graph import build_graph
from app.agent.memory import create_saver
from app.api.routes import router
from app.core.config import settings
from app.core.errors import register_exception_handlers


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Boot: setup checkpointer tables, compile the graph once, share via app.state."""
    saver, close_saver = await create_saver()
    try:
        app.state.graph = build_graph(checkpointer=saver, model_name=settings.ai_model)
        yield
    finally:
        await close_saver(None, None, None)


app = FastAPI(title="kosply-agent", version="0.1.0", lifespan=lifespan)
register_exception_handlers(app)
app.include_router(router)


@app.get("/")
async def root() -> dict:
    """Root info for load-balancer checks."""
    return {"name": "kosply-agent", "status": "ok"}


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port)
