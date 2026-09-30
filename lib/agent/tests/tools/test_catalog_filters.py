"""Catalog filter tests: tool-side price/category filtering (mocked HTTP)."""

from unittest import mock

from app.agent.tools import search_catalog
from tests.base_test import BaseAgentTest

ITEMS = [
    {"id": "p1", "title": "Kipas", "price": 150000, "category": "Elektronik"},
    {"id": "p2", "title": "Buku", "price": 45000, "category": None},
]


class FakeResp:
    """Minimal httpx response double."""

    def __init__(self, payload):
        """Store the payload returned by json()."""
        self._payload = payload

    def raise_for_status(self):
        """Never fails (happy-path double)."""

    def json(self):
        """Return the canned payload."""
        return self._payload


def _run(query="x", **kwargs):
    """Invoke the real tool with mocked HTTP."""
    with mock.patch(
        "app.agent.tools.catalog.catalog.httpx.get",
        return_value=FakeResp({"status": "ok", "items": ITEMS}),
    ):
        return search_catalog.invoke({"query": query, **kwargs})


class CatalogFilterTest(BaseAgentTest):
    """Price/category filters apply to live-shaped server payloads."""

    def test_no_filters_returns_all(self):
        """Without filters the server list passes through."""
        out = _run("x")
        self.assertIn("p1", out)
        self.assertIn("p2", out)

    def test_max_price_filters(self):
        """Items above max_price drop out."""
        out = _run("x", max_price=100000)
        self.assertNotIn("p1", out)
        self.assertIn("p2", out)

    def test_category_filters_case_insensitively(self):
        """Category match ignores case; null categories never match."""
        out = _run("x", category="elektronik")
        self.assertIn("p1", out)
        self.assertNotIn("p2", out)

    def test_tool_error_on_transport_failure(self):
        """HTTP failures surface as ToolError (no silent fallback)."""
        from app.core.errors import ToolError

        with mock.patch(
            "app.agent.tools.catalog.catalog.httpx.get",
            side_effect=ConnectionError("down"),
        ):
            with self.assertRaises(ToolError):
                search_catalog.invoke({"query": "x"})
