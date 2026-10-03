"""The system prompt must actually tell the model what a product is.

The prompt used to be four lines of Indonesian that named Kosply and listed
topics, but said nothing about products: not what fields a listing has, not that
`price` is rupiah, not that search only returns ACTIVE items, and not that the
model has to call `search_catalog` instead of recalling listings. A model given
that prompt invents products, prices and sellers.

These tests pin the domain knowledge and the reply-language rule.
"""

import unittest

from app.agent.policy.personas.personas import (
    BUYER_PERSONA,
    NEUTRAL_PERSONA,
    SELLER_PERSONA,
    build_system_prompt,
)
from app.agent.policy.scope.rules import SYSTEM_PROMPT


class SystemPromptProductKnowledgeTest(unittest.TestCase):
    """The prompt must describe the product domain it reasons about."""

    def test_prompt_is_written_in_english(self):
        # English instructions are followed more reliably and cost fewer tokens
        # than Indonesian ones. The answer language is decided separately, per
        # user, so the prompt itself should not be Indonesian.
        for marker in ("You are", "product", "search_catalog"):
            self.assertIn(marker, SYSTEM_PROMPT)
        self.assertNotIn("Kamu adalah", SYSTEM_PROMPT)

    def test_defines_every_product_field_the_tools_return(self):
        # Each of these is a real column on Product / the public select. If the
        # prompt drifts from the schema the model will misread a result.
        for field in (
            "id",
            "title",
            "description",
            "price",
            "stock",
            "category",
            "status",
            "seller",
        ):
            self.assertIn(f"`{field}`", SYSTEM_PROMPT, f"prompt does not explain `{field}`")

    def test_explains_status_values(self):
        for value in ("ACTIVE", "SOLD", "ARCHIVED"):
            self.assertIn(value, SYSTEM_PROMPT)

    def test_price_is_rupiah_integer(self):
        # The single most expensive misunderstanding: price is an integer count
        # of rupiah, so 150000 is Rp150.000.
        low = SYSTEM_PROMPT.lower()
        self.assertIn("rupiah", low)
        self.assertIn("integer", low)

    def test_says_search_returns_only_active(self):
        low = SYSTEM_PROMPT.lower()
        self.assertIn("only `active`", low)
        self.assertIn("sold", low)

    def test_requires_the_search_tool_rather_than_recall(self):
        low = SYSTEM_PROMPT.lower()
        self.assertIn("must call", low)
        self.assertIn("never invent", low)

    def test_documents_the_category_trap(self):
        # Product.category is free text typed by the seller, so a tidy category
        # word like "elektronik" filters to nothing. The model needs to know to
        # prefer keyword search.
        low = SYSTEM_PROMPT.lower()
        self.assertIn("free text", low)
        self.assertIn("category", low)

    def test_names_the_sensitive_tools(self):
        for name in ("request_seller_contact", "send_chat_message"):
            self.assertIn(name, SYSTEM_PROMPT)
        self.assertIn("approval", SYSTEM_PROMPT.lower())

    def test_treats_seller_text_as_data_not_instructions(self):
        # Product descriptions are attacker-controlled free text.
        low = SYSTEM_PROMPT.lower()
        self.assertIn("prompt injection", low)
        self.assertIn("data", low)


class ReplyLanguageTest(unittest.TestCase):
    """The answer language follows the user; it is not pinned to Indonesian."""

    def test_prompt_mirrors_the_user_language(self):
        low = SYSTEM_PROMPT.lower()
        self.assertIn("same language", low)
        # The old hard rule told the model to always answer in Indonesian,
        # which made an English-speaking user get Indonesian replies.
        self.assertNotIn("bahasa indonesia", low)

    def test_personas_do_not_pin_the_language(self):
        for block in (SELLER_PERSONA, BUYER_PERSONA, NEUTRAL_PERSONA):
            self.assertNotIn("bahasa indonesia", block.lower())

    def test_personas_are_english_instructions(self):
        for block in (SELLER_PERSONA, BUYER_PERSONA, NEUTRAL_PERSONA):
            self.assertTrue(block.startswith("[MODE:"), block[:40])

    def test_persona_markers_are_stable(self):
        self.assertIn("[MODE: SELLER]", SELLER_PERSONA)
        self.assertIn("[MODE: BUYER]", BUYER_PERSONA)
        self.assertIn("[MODE: GENERAL]", NEUTRAL_PERSONA)

    def test_build_prompt_keeps_scope_and_appends_persona(self):
        combined = build_system_prompt(SYSTEM_PROMPT, "SELLER")
        self.assertTrue(combined.startswith(SYSTEM_PROMPT))
        self.assertIn("[MODE: SELLER]", combined)


class CannedReplyLanguageTest(unittest.TestCase):
    """Pre-LLM refusals are shown verbatim, so they must not be Indonesian-only.

    They cannot follow "reply in the user's language" -- no model is involved --
    so they carry both languages instead.
    """

    def test_rejections_are_bilingual(self):
        from app.agent.policy.scope.rules import (
            EMPTY_MESSAGE,
            REJECTION_MESSAGE,
            TOO_LONG_MESSAGE,
        )

        for message in (REJECTION_MESSAGE, TOO_LONG_MESSAGE, EMPTY_MESSAGE):
            self.assertIn("/", message, f"not bilingual: {message}")
        # English must actually be present, not just a stray slash.
        self.assertIn("Sorry", REJECTION_MESSAGE)
        self.assertIn("too long", TOO_LONG_MESSAGE.lower())
        self.assertIn("empty message", EMPTY_MESSAGE.lower())


if __name__ == "__main__":
    unittest.main()