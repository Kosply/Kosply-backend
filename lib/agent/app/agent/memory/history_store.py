"""Shared history storage: mirror turns into `ai_conversations`/`ai_messages`.

Same Postgres, same tables Prisma maps (see `lib/db`). The LangGraph
checkpointer keeps the runnable state; these tables keep the app-level
history the server/Flutter read. `thread_id == ai_conversations.id`.

Best-effort by design: without `DATABASE_URL` (or when the mirror fails,
e.g. the user row doesn't exist yet) the turn is skipped with a warning —
chat itself never breaks.
"""

import logging
import uuid

from app.core.config import settings

logger = logging.getLogger(__name__)

_ROLE_TO_DB = {"human": "USER", "ai": "ASSISTANT", "system": "SYSTEM"}


def to_db_role(role: str) -> str | None:
    """Map a message role to `AiMessageRole`. Tool messages are skipped (None)."""
    return _ROLE_TO_DB.get(role)


def _new_id() -> str:
    """Random TEXT pk (TEXT column accepts non-cuid strings)."""
    return uuid.uuid4().hex


async def _connect():
    """Open a short-lived async connection (basic: one per call)."""
    from psycopg import AsyncConnection

    from app.core.dsn import pg_dsn

    return await AsyncConnection.connect(pg_dsn(settings.database_url))


async def ensure_conversation(conversation_id: str, user_id: str, title: str) -> None:
    """Insert the session row once; no-op when switched off."""
    if not settings.database_url:
        return
    conn = await _connect()
    try:
        async with conn.transaction():
            await conn.execute(
                'INSERT INTO "ai_conversations" ("id", "userId", "title", "createdAt", "updatedAt")'
                " VALUES (%s, %s, %s, NOW(), NOW())"
                ' ON CONFLICT ("id") DO NOTHING',
                (conversation_id, user_id, title[:120]),
            )
    finally:
        await conn.close()


async def append_message(
    conversation_id: str, role: str, content: str, model: str | None = None
) -> None:
    """Append one row to `ai_messages` + bump `lastMessageAt`. Tool rows skipped."""
    if not settings.database_url:
        return
    db_role = to_db_role(role)
    if db_role is None:
        return
    conn = await _connect()
    try:
        async with conn.transaction():
            await conn.execute(
                'INSERT INTO "ai_messages" ("id", "conversationId", "role", "content", "model", "createdAt")'
                ' VALUES (%s, %s, %s::"AiMessageRole", %s, %s, NOW())',
                (_new_id(), conversation_id, db_role, content, model),
            )
            await conn.execute(
                'UPDATE "ai_conversations" SET "lastMessageAt" = NOW(), "updatedAt" = NOW()'
                ' WHERE "id" = %s',
                (conversation_id,),
            )
    finally:
        await conn.close()


async def load_history(conversation_id: str) -> list:
    """Load stored rows as [{role, content}] (roles: human/ai/system). Empty when off."""
    if not settings.database_url:
        return []
    back = {"USER": "human", "ASSISTANT": "ai", "SYSTEM": "system"}
    conn = await _connect()
    try:
        cur = await conn.execute(
            'SELECT "role", "content" FROM "ai_messages"'
            ' WHERE "conversationId" = %s ORDER BY "createdAt" ASC',
            (conversation_id,),
        )
        rows = await cur.fetchall()
    finally:
        await conn.close()
    return [{"role": back.get(r[0], "unknown"), "content": r[1]} for r in rows]


async def sync_turn(
    conversation_id: str, user_id: str, user_message: str, answer: str
) -> None:
    """Mirror one finished turn (user + assistant). Warns and continues on failure."""
    if not settings.database_url:
        return
    try:
        await ensure_conversation(conversation_id, user_id, user_message or "(resumed turn)")
        if user_message:
            await append_message(conversation_id, "human", user_message)
        if answer:
            await append_message(conversation_id, "ai", answer, settings.ai_model)
    except Exception as exc:
        logger.warning("history mirror skipped: %s", exc)
