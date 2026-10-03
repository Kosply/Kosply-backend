"""The agent's tools must authenticate to the server's internal API.

Every `/api/internal/*` route is behind `requireInternalKey`. None of the six
outbound tool calls sent `x-internal-key`, so all of them returned 401 and were
surfaced to the model as `ToolError`: the agent could hold a conversation but
could not search the catalog, read a product, look up a role, read a COD room
or request contact. These tests pin the header on every outbound call.
"""

import os
import unittest
from unittest import mock

from app.core import http as agent_http
from app.core.errors import ToolError


KEY = "shared-secret-key"


def with_key(value):
    """A settings copy carrying `value` as the internal key.

    `Settings` is a frozen dataclass, so tests cannot assign the field; they
    swap the module's `settings` reference for a rebuilt copy instead.
    """
    import dataclasses

    from app.core.config import settings as real

    return dataclasses.replace(real, internal_api_key=value)


class OutboundAuthTest(unittest.TestCase):
    """`server_get` / `server_post` must attach the shared key."""

    def setUp(self):
        self._patcher = mock.patch.object(agent_http, "settings", with_key(KEY))
        self._patcher.start()
        self.addCleanup(self._patcher.stop)

    def _capture(self, fn, *args, **kwargs):
        seen = {}

        def fake_get(url, **kw):
            seen["url"] = url
            seen["headers"] = kw.get("headers")
            seen["timeout"] = kw.get("timeout")
            return mock.Mock(status_code=200, raise_for_status=lambda: None)

        def fake_post(url, **kw):
            seen["url"] = url
            seen["headers"] = kw.get("headers")
            seen["timeout"] = kw.get("timeout")
            return mock.Mock(status_code=200, raise_for_status=lambda: None)

        with mock.patch.object(agent_http.httpx, "get", fake_get), mock.patch.object(
            agent_http.httpx, "post", fake_post
        ):
            fn(*args, **kwargs)
        return seen

    def test_server_get_sends_the_internal_key(self):
        seen = self._capture(agent_http.server_get, "/api/internal/products/search")
        self.assertEqual(seen["headers"], {"x-internal-key": KEY})

    def test_server_post_sends_the_internal_key(self):
        seen = self._capture(agent_http.server_post, "/api/internal/contact-requests")
        self.assertEqual(seen["headers"], {"x-internal-key": KEY})

    def test_missing_key_fails_loudly_rather_than_sending_unauthenticated(self):
        # Silently issuing an unauthenticated request would produce six
        # identical, unexplained 401s instead of one clear configuration error.
        with mock.patch.object(agent_http, "settings", with_key("")):
            pass
        self._patcher.stop()
        self._patcher = mock.patch.object(agent_http, "settings", with_key(""))
        self._patcher.start()
        with self.assertRaises(RuntimeError) as ctx:
            agent_http.server_headers()
        self.assertIn("INTERNAL_API_KEY", str(ctx.exception))

    def test_blank_key_is_treated_as_missing(self):
        self._patcher.stop()
        self._patcher = mock.patch.object(agent_http, "settings", with_key("   "))
        self._patcher.start()
        with self.assertRaises(RuntimeError):
            agent_http.server_headers()


class ToolCallAuthTest(unittest.TestCase):
    """Each tool must route through the authenticated helper."""

    def setUp(self):
        self._patcher = mock.patch.object(agent_http, "settings", with_key(KEY))
        self._patcher.start()
        self.addCleanup(self._patcher.stop)

    def _assert_tools_never_call_raw_httpx(self, module_name, tool_names):
        """Fail if a tool module reaches for `httpx.get/post` directly."""
        import importlib

        module = importlib.import_module(module_name)
        source = open(module.__file__).read()
        for forbidden in ("httpx.get(", "httpx.post("):
            self.assertNotIn(
                forbidden,
                source,
                f"{module_name} calls {forbidden} directly and skips the "
                f"x-internal-key header; use app.core.http instead",
            )
        # And it must import the helper.
        self.assertIn(
            "app.core.http",
            source,
            f"{module_name} does not import the authenticated helper",
        )

    def test_catalog_tools_use_the_helper(self):
        self._assert_tools_never_call_raw_httpx(
            "app.agent.tools.catalog.catalog", ["search_catalog", "get_product_detail"]
        )

    def test_roles_tool_uses_the_helper(self):
        self._assert_tools_never_call_raw_httpx(
            "app.agent.tools.roles.roles", ["get_user_role"]
        )

    def test_chat_tools_use_the_helper(self):
        self._assert_tools_never_call_raw_httpx(
            "app.agent.tools.chat.chat", ["read_conversation", "send_chat_message"]
        )

    def test_contact_tool_uses_the_helper(self):
        self._assert_tools_never_call_raw_httpx(
            "app.agent.tools.contact.contact", ["request_seller_contact"]
        )

    def test_read_conversation_requires_a_session_user(self):
        """The server's membership gate needs `userId`; without state it 400s."""
        from app.agent.tools.chat.chat import read_conversation

        out = read_conversation.invoke({"conversation_id": "c1", "state": {}})
        self.assertIn("No user in session", out)

    def test_read_conversation_sends_user_id(self):
        from app.agent.tools.chat.chat import read_conversation

        captured = {}

        def fake_get(path, **kw):
            captured["path"] = path
            captured["params"] = kw.get("params")
            return mock.Mock(status_code=200, raise_for_status=lambda: None)

        with mock.patch("app.agent.tools.chat.chat.server_get", fake_get):
            read_conversation.invoke(
                {"conversation_id": "c1", "state": {"user_id": "u-123"}}
            )
        self.assertEqual(captured["params"], {"userId": "u-123"})

    def test_send_chat_message_still_refuses_without_a_session(self):
        from app.agent.tools.chat.chat import send_chat_message

        out = send_chat_message.invoke(
            {"conversation_id": "c1", "text": "hi", "state": {}}
        )
        self.assertIn("No user in session", out)


if __name__ == "__main__":
    unittest.main()