"""Health routes: liveness + readiness probes."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.agent.memory import describe_saver
from app.core.config import pg_dsn, settings

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
        from psycopg import AsyncConnection

        conn = await AsyncConnection.connect(pg_dsn(settings.database_url or ""))
        try:
            await conn.execute("SELECT 1")
        finally:
            await conn.close()
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"status": "down", "checkpointer": backend},
        )
    return {"status": "ok", "checkpointer": backend}
