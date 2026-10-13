"""Health routes: liveness + readiness probes."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.agent.memory import describe_saver
from app.core.config import mysql_conn_kwargs, settings

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    """Liveness probe."""
    return {"status": "ok", "service": "kosply-agent"}


@router.get("/readyz")
async def ready(request: Request) -> dict:
    """Readiness probe: 200 when the persistence backend answers."""
    backend = describe_saver(request.app.state.saver)
    if backend == "memory":
        return {"status": "degraded", "checkpointer": backend}
    try:
        import aiomysql

        async with aiomysql.connect(**mysql_conn_kwargs(settings.database_url or "")) as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT 1")
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"status": "down", "checkpointer": backend},
        )
    return {"status": "ok", "checkpointer": backend}
