"""History-store tests: role mapping + off-mode (no DATABASE_URL in tests)."""

from app.agent.memory import history_store
from app.agent.memory.history_store import sync_turn, to_db_role
from tests.base_test import BaseAgentTest


class HistoryStoreTest(BaseAgentTest):
    """Shared-table mirror is best-effort: silent no-op without a database."""

    def test_role_mapping(self):
        """Agent roles map to AiMessageRole; tool rows are skipped (None)."""
        self.assertEqual(to_db_role("human"), "USER")
        self.assertEqual(to_db_role("ai"), "ASSISTANT")
        self.assertEqual(to_db_role("system"), "SYSTEM")
        self.assertIsNone(to_db_role("tool"))

    async def test_sync_is_noop_without_database(self):
        """Without DATABASE_URL the mirror silently does nothing."""
        self.assertIsNone(history_store.settings.database_url)
        self.assertIsNone(await sync_turn("c1", "u1", "halo", "hai"))
        self.assertEqual(await history_store.load_history("c1"), [])
