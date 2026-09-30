"""History-store tests: role mapping + off-mode (stubbed settings)."""

from types import SimpleNamespace
from unittest import mock

from app.agent.memory.history import history_store
from app.agent.memory import sync_turn, to_db_role
from tests.base_test import BaseAgentTest

OFF_SETTINGS = SimpleNamespace(database_url=None)


class HistoryStoreTest(BaseAgentTest):
    """Shared-table mirror is best-effort: silent no-op without a database."""

    def test_role_mapping(self):
        """Agent roles map to AiMessageRole; tool rows are skipped (None)."""
        self.assertEqual(to_db_role("human"), "USER")
        self.assertEqual(to_db_role("ai"), "ASSISTANT")
        self.assertEqual(to_db_role("system"), "SYSTEM")
        self.assertIsNone(to_db_role("tool"))

    async def test_sync_is_noop_without_database(self):
        """Without DATABASE_URL the mirror silently does nothing (any local .env)."""
        with mock.patch.object(history_store, "settings", OFF_SETTINGS):
            self.assertIsNone(await sync_turn("c1", "u1", "halo", "hai"))
            self.assertEqual(await history_store.load_history("c1"), [])
