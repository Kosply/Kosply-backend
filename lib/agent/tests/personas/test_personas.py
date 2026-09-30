"""Persona tests: the agent reads the user role and switches personality."""

from httpx import ASGITransport, AsyncClient
from langgraph.checkpoint.memory import InMemorySaver

from app.agent.graph import build_graph
from app.agent.policy import (
    SYSTEM_PROMPT,
    build_system_prompt,
    ensure_system_prompt,
    persona_for,
)
from app.agent.tools import TOOLS, get_user_role
from app.main import app
from tests.base_test import BaseAgentTest, StatefulFakeChatModel, canned_answer


class PersonaMappingTest(BaseAgentTest):
    """Role strings map to the right persona block."""

    def test_seller_persona(self):
        """SELLER (any case) yields the seller mode block."""
        self.assertIn("[MODE: PENJUAL]", persona_for("seller"))

    def test_buyer_persona(self):
        """BUYER yields the buyer mode block."""
        self.assertIn("[MODE: PEMBELI]", persona_for("BUYER"))

    def test_unknown_is_neutral(self):
        """Missing/unknown roles fall back to neutral (never crash)."""
        for role in (None, "", "UNKNOWN", "ADMIN"):
            self.assertIn("[MODE: UMUM]", persona_for(role))

    def test_prompt_combines_scope_and_persona(self):
        """Built prompt keeps the Kosply scope plus the persona."""
        prompt = build_system_prompt(SYSTEM_PROMPT, "SELLER")
        self.assertIn("Kosply", prompt)
        self.assertIn("[MODE: PENJUAL]", prompt)


class PersonaWiringTest(BaseAgentTest):
    """The model receives the persona matching the caller role."""

    async def test_seller_mode_reaches_model(self):
        """user_role=SELLER puts the seller block first in the LLM input."""
        fake = StatefulFakeChatModel(responses=[canned_answer("ok")])
        graph = build_graph(InMemorySaver(), llm=fake)
        await self.loop(graph, [("send", "halo")], role="SELLER")
        self.assertIn("[MODE: PENJUAL]", fake.seen_inputs[0][0].content)

    async def test_buyer_mode_reaches_model(self):
        """user_role=BUYER puts the buyer block first in the LLM input."""
        fake = StatefulFakeChatModel(responses=[canned_answer("ok")])
        graph = build_graph(InMemorySaver(), llm=fake)
        await self.loop(graph, [("send", "halo")], role="BUYER")
        self.assertIn("[MODE: PEMBELI]", fake.seen_inputs[0][0].content)

    async def test_role_persists_for_resume(self):
        """Persona survives across turns on one thread (no re-send needed)."""
        fake = StatefulFakeChatModel(
            responses=[canned_answer("satu"), canned_answer("dua")]
        )
        graph = build_graph(InMemorySaver(), llm=fake)
        await self.loop(graph, [("send", "halo"), ("send", "lanjut")], role="SELLER")
        for seen in fake.seen_inputs:
            self.assertIn("[MODE: PENJUAL]", seen[0].content)

    def test_role_tool_registered_plain(self):
        """get_user_role is a plain (non-sensitive) registered tool."""
        from app.agent.tools import SENSITIVE_TOOLS

        self.assertIn(get_user_role, TOOLS)
        self.assertNotIn("get_user_role", SENSITIVE_TOOLS)

    def test_ensure_keeps_role_param(self):
        """Helper stays backward compatible without a role."""
        [first] = ensure_system_prompt([])
        self.assertIn("[MODE: UMUM]", first.content)


class PersonaRouteTest(BaseAgentTest):
    """HTTP role field flows end to end."""

    async def test_chat_with_role(self):
        """POST /ai/chat accepts role and answers normally."""
        self.mount_fake([canned_answer("siap bantu jualan")])
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            res = await client.post(
                "/ai/chat",
                json={"conversation_id": "c-role-1", "user_id": "u1",
                      "role": "SELLER", "message": "halo"},
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["answer"], "siap bantu jualan")
