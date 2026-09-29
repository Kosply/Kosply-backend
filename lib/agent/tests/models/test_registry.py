"""Registry tests: provider prefix, lookup, resolution order."""

from unittest import mock

from app.agent.models.registry import (
    FALLBACK_TOTAL,
    clear_cache,
    fetch_context_window,
    resolve_context_total,
    strip_provider,
)
from tests.base_test import BaseAgentTest

MODELS_PAYLOAD = {"data": [
    {"id": "cmc/stealth/space-bunny-alpha", "context_length": 1000000},
    {"id": "other", "capabilities": {"contextWindow": 64000}},
]}


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


class RegistryTest(BaseAgentTest):
    """Prefix stripping, provider lookup, explicit-wins resolution."""

    def setUp(self):
        """Clear the process cache so each test resolves fresh."""
        super().setUp()
        clear_cache()

    def test_strip_provider(self):
        """Client prefixes drop for provider lookup; bare ids pass through."""
        self.assertEqual(strip_provider("openai:cmc/x"), "cmc/x")
        self.assertEqual(strip_provider("cmc/x"), "cmc/x")

    def test_fetch_prefers_context_length(self):
        """Top-level context_length wins over nested capabilities."""
        with mock.patch("httpx.get", return_value=FakeResp(MODELS_PAYLOAD)):
            self.assertEqual(
                fetch_context_window("cmc/stealth/space-bunny-alpha",
                                     base_url="http://x", api_key="k"),
                1000000,
            )
            self.assertEqual(
                fetch_context_window("other", base_url="http://x", api_key="k"),
                64000,
            )
            self.assertIsNone(
                fetch_context_window("missing", base_url="http://x", api_key="k")
            )

    def test_fetch_failure_is_none(self):
        """Unreachable providers yield None (caller falls back)."""
        with mock.patch("httpx.get", side_effect=ConnectionError("down")):
            self.assertIsNone(
                fetch_context_window("x", base_url="http://x", api_key="k")
            )

    def test_explicit_wins_over_provider(self):
        """Explicit env total skips the network entirely."""
        with mock.patch("httpx.get", side_effect=AssertionError("must not call")):
            self.assertEqual(
                resolve_context_total("openai:cmc/x", explicit=128000,
                                      base_url="http://x", api_key="k"),
                128000,
            )

    def test_provider_then_cached(self):
        """First call hits the network once; repeats come from cache."""
        with mock.patch("httpx.get", return_value=FakeResp(MODELS_PAYLOAD)) as get:
            first = resolve_context_total("openai:cmc/stealth/space-bunny-alpha",
                                          explicit=0, base_url="http://x", api_key="k")
            second = resolve_context_total("openai:cmc/stealth/space-bunny-alpha",
                                           explicit=0, base_url="http://x", api_key="k")
        self.assertEqual((first, second), (1000000, 1000000))
        self.assertEqual(get.call_count, 1)

    def test_fallback_without_provider(self):
        """No base URL and no explicit value fall back safely."""
        self.assertEqual(
            resolve_context_total("openai:x", explicit=0, base_url="", api_key=""),
            FALLBACK_TOTAL,
        )
