"""Live wiring proof: agent tools against a real server + seeded DB.

Opt-in only (needs network + data), so the default suite stays hermetic:

    E2E_LIVE=1 KOSPLY_SERVER_URL=http://localhost:3100 \\
      .venv/bin/python -m pytest tests/e2e -v

Requires: server booted with DATABASE_URL + `npm run seed` in lib/db.
"""

import os

from tests.base_test import BaseAgentTest

LIVE = os.getenv("E2E_LIVE") == "1"


class LiveWiringTest(BaseAgentTest):
    """Agent -> server -> db paths return real data (seeded fixtures)."""

    def _require_live(self):
        if not LIVE:
            self.skipTest("set E2E_LIVE=1 with a live seeded server")

    def test_search_returns_seed(self):
        """Catalog search finds the seeded fan."""
        self._require_live()
        from app.agent.tools.catalog import search_catalog

        self.assertIn("Kipas", search_catalog.invoke({"query": "kipas"}))

    def test_unknown_product_is_tool_error(self):
        """Server 404 surfaces as ToolError (no silent fallback)."""
        self._require_live()
        from app.core.errors import ToolError
        from app.agent.tools.catalog import get_product_detail

        with self.assertRaises(ToolError):
            get_product_detail.invoke({"product_id": "does-not-exist"})
