"""Shared history storage: mirror turns into `ai_conversations`/`ai_messages`.

Same MariaDB, same tables Prisma maps (see `lib/db`). The LangGraph
checkpointer keeps the runnable state; these tables keep the app-level
history the server/Flutter read. `thread_id == ai_conversations.id`.

Best-effort by design: without `DATABASE_URL` (or when the mirror fails,
e.g. the user row doesn't exist yet) the turn is skipped with a warning —
chat itself never breaks.

SQL dialect notes (migrated from PostgreSQL):
- identifiers are backtick-quoted (MySQL treats `"x"` as a string literal);
- `ON CONFLICT ... DO NOTHING` -> `INSERT IGNORE` (needs the PK/unique on id,
  which the schema has);
- no `::"AiMessageRole"` cast: the column is a native MySQL ENUM and accepts
  the role string directly.
"""

import logging
import uuid

from app.core.config import mysql_conn_kwargs, settings

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
    import aiomysql

    return await aiomysql.connect(**mysql_conn_kwargs(settings.database_url))


async def ensure_conversation(conversation_id: str, user_id: str, title: str) -> None:
    """Insert the session row once; no-op when switched off."""
    if not settings.database_url:
        return
    conn = await _connect()
    try:
        # aiomysql connections default to autocommit=False: manage it here.
        await conn.begin()
        try:
            async with conn.cursor() as cur:
                await cur.execute(
                    'INSERT IGNORE INTO `ai_conversations`'
                    ' (`id`, `userId`, `title`, `createdAt`, `updatedAt`)'
                    " VALUES (%s, %s, %s, NOW(), NOW())",
                    (conversation_id, user_id, title[:120]),
                )
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise
    finally:
        conn.close()


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
        await conn.begin()
        try:
            async with conn.cursor() as cur:
                await cur.execute(
                    'INSERT INTO `ai_messages`'
                    ' (`id`, `conversationId`, `role`, `content`, `model`, `createdAt`)'
                    ' VALUES (%s, %s, %s, %s, %s, NOW())',
                    (_new_id(), conversation_id, db_role, content, model),
                )
                await cur.execute(
                    'UPDATE `ai_conversations` SET `lastMessageAt` = NOW(), `updatedAt` = NOW()'
                    ' WHERE `id` = %s',
                    (conversation_id,),
                )
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise
    finally:
        conn.close()


async def load_history(conversation_id: str) -> list:
    """Load stored rows as [{role, content}] (roles: human/ai/system). Empty when off."""
    if not settings.database_url:
        return []
    back = {"USER": "human", "ASSISTANT": "ai", "SYSTEM": "system"}
    conn = await _connect()
    try:
        async with conn.cursor() as cur:
            await cur.execute(
                'SELECT `role`, `content` FROM `ai_messages`'
                ' WHERE `conversationId` = %s ORDER BY `createdAt` ASC',
                (conversation_id,),
            )
            rows = await cur.fetchall()
    finally:
        conn.close()
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
