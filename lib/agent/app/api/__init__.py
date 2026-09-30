"""HTTP layer: one router aggregating per-function sub-routers."""

from fastapi import APIRouter

from app.api.chat.routes import router as chat_router
from app.api.health.routes import router as health_router
from app.api.history.routes import router as history_router

router = APIRouter()
router.include_router(health_router)
router.include_router(chat_router)
router.include_router(history_router)
