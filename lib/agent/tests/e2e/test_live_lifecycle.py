"""Live lifecycle test with a REAL model (no fakes).

Covers the whole loop on one thread: message -> tool answer -> interrupt ->
resume(approve) -> fresh instance -> follow-up from persisted memory.

Opt-in only (costs real model calls + needs live infra):

    E2E_LIVE_AI=1 KOSPLY_SERVER_URL=http://localhost:3100 \\
      .venv/bin/python -m pytest tests/e2e/test_live_lifecycle.py -v

Requires: server booted with DATABASE_URL (+ seeded dev-product-1),
agent DATABASE_URL for the Postgres checkpointer, and model credentials
(OPENAI_API_KEY / base URL in lib/agent/.env).
"""

import asyncio
import os
import time

import httpx
from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage
from langgraph.types import Command

from app.agent.graph import build_graph
from app.agent.memory.checkpointer import create_saver
from app.core.config import settings
from tests.base_test import BaseAgentTest

CALL_TIMEOUT_S = 180.0


class LiveLifecycleTest(BaseAgentTest):
    """Full lifecycle against live server + live model + Postgres memory."""

    def _require_live(self):
        if os.getenv("E2E_LIVE_AI") != "1":
            self.skipTest("set E2E_LIVE_AI=1 (needs live server, DB, model)")
        try:
            res = httpx.get(f"{settings.kosply_server_url}/api/health", timeout=5.0)
            res.raise_for_status()
        except Exception as exc:
            self.fail(f"live server unreachable at {settings.kosply_server_url}: {exc}")
        if not settings.database_url:
            self.fail("DATABASE_URL is required for the Postgres checkpointer")
        return True

    def _register_temp_user(self):
        """Create a throwaway user through the real register endpoint."""
        tag = f"lc{int(time.time() * 1000)}"
        res = httpx.post(
            f"{settings.kosply_server_url}/api/auth/register",
            json={"email": f"{tag}@kosply.test", "username": tag, "name": "Cycle",
                  "password": "secret123", "universitas": "U", "programStudi": "P"},
            timeout=15.0,
        )
        assert res.status_code == 201, res.text
        return res.json()["user"]

    def _cleanup_user(self, email):
        """Delete the temp user (cascades conversations, messages, resets)."""
        from psycopg import Connection

        from app.core.dsn import pg_dsn

        with Connection.connect(pg_dsn(settings.database_url)) as conn:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM "users" WHERE "email" = %s', (email,))
            conn.commit()

    async def _invoke(self, graph, payload, thread):
        """One graph turn with a hard ceiling (hung models fail, never hang)."""
        return await asyncio.wait_for(
            graph.ainvoke(payload, {"configurable": {"thread_id": thread}}),
            timeout=CALL_TIMEOUT_S,
        )

    async def test_full_lifecycle(self):
        """message -> tool -> interrupt -> approve -> fresh instance remembers."""
        self._require_live()

        thread = f"e2e-ai-{int(time.time())}"
        email = None
        user = None
        saver, close_saver = await create_saver()
        try:
            user = self._register_temp_user()
            email = user["email"]
            llm = init_chat_model(settings.ai_model)
            graph = build_graph(saver, llm=llm)

            # 1. Catalog turn: model should call search_catalog, answer from it.
            first = await self._invoke(
                graph,
                {"messages": [HumanMessage(content="cari kipas angin second di bawah 200 ribu")],
                 "user_id": user["id"], "user_role": "BUYER"},
                thread,
            )
            tool_names = [c.get("name") for m in first.get("messages", [])
                          for c in (getattr(m, "tool_calls", None) or [])]
            self.assertIn("search_catalog", tool_names,
                          "model must use the catalog tool for product search")
            answer = next((m.content for m in reversed(first.get("messages", []))
                           if getattr(m, "type", "") == "ai" and m.content), "")
            self.assertIn("kipas", answer.lower(),
                          "answer must come from live catalog data")

            # 2. Sensitive turn: model should request approval, graph must pause.
            second = await self._invoke(
                graph,
                {"messages": [HumanMessage(
                    content="hubungi seller produk dev-product-1 untuk saya, pesannya: halo masih ada?")],
                 "user_id": user["id"], "user_role": "BUYER"},
                thread,
            )
            self.assertIn("__interrupt__", second, "sensitive tool must pause for approval")
            pending = second["__interrupt__"][0].value["pending_tools"]
            self.assertEqual(pending[0]["name"], "request_seller_contact")

            # 3. Approve: tool POSTs to the live server, turn completes.
            third = await self._invoke(graph, Command(resume="approve"), thread)
            self.assertNotIn("__interrupt__", third, "no chained interrupt expected")
            final = next((m.content for m in reversed(third.get("messages", []))
                          if getattr(m, "type", "") == "ai" and m.content), "")
            self.assertTrue(final.strip(), "approved turn must produce an answer")
        finally:
            await close_saver(None, None, None)
            if email:
                self._cleanup_user(email)

        # 4. Fresh instance, same thread: persisted memory answers the follow-up.
        self.assertIsNotNone(user, "earlier phases must succeed first")
        saver2, close2 = await create_saver()
        try:
            graph2 = build_graph(saver2, llm=init_chat_model(settings.ai_model))
            fourth = await self._invoke(
                graph2,
                {"messages": [HumanMessage(content="oke, makasih infonya")],
                 "user_id": user["id"], "user_role": "BUYER"},
                thread,
            )
            closing = next((m.content for m in reversed(fourth.get("messages", []))
                            if getattr(m, "type", "") == "ai" and m.content), "")
            self.assertTrue(closing.strip(), "resumed session must answer on a fresh instance")
        finally:
            await close2(None, None, None)
