"""Navigation derived from catalog and message tools, without a model."""

import unittest

from langchain_core.messages import ToolMessage

from app.agent.navigation import TurnNavigation
from app.api.shared import _extract_callbacks


def _search(*items):
    return str({"status": "ok", "items": list(items)})


class TurnNavigationTest(unittest.TestCase):
    """A search opens the chosen product. A draft opens the chat first."""

    def test_cheapest_search_opens_that_product(self):
        nav = TurnNavigation()
        nav.note_message(
            "search_catalog",
            _search(
                {"id": "pricey", "price": 900000},
                {"id": "cheap", "price": 150000},
            ),
        )
        self.assertEqual(
            nav.callbacks(),
            [{"callback": "open_product", "args": {"productId": "cheap"}}],
        )

    def test_detail_replaces_the_search_pick(self):
        nav = TurnNavigation()
        nav.note_message("search_catalog", _search({"id": "cheap", "price": 10}))
        nav.note_message("get_product_detail", str({"item": {"id": "chosen", "price": 80}}))
        self.assertEqual(nav.callbacks()[0]["args"]["productId"], "chosen")

    def test_message_draft_opens_chat_before_it_is_sent(self):
        nav = TurnNavigation()
        nav.note_message("search_catalog", _search({"id": "p1", "price": 10}))
        pending = [
            {
                "pending_tools": [
                    {
                        "name": "request_seller_contact",
                        "args": {"product_id": "p1", "message": "masih ada?"},
                    }
                ]
            }
        ]
        moves = nav.callbacks(pending)
        self.assertEqual(moves, [{"callback": "open_chat", "args": {"productId": "p1"}}])

    def test_existing_room_opens_by_conversation_id(self):
        nav = TurnNavigation()
        moves = nav.callbacks(
            [
                {
                    "pending_tools": [
                        {
                            "name": "send_chat_message",
                            "args": {"conversation_id": "room-1", "text": "besok ya"},
                        }
                    ]
                }
            ]
        )
        self.assertEqual(
            moves,
            [{"callback": "open_chat", "args": {"conversationId": "room-1"}}],
        )

    def test_named_screen_wins_over_a_searched_product(self):
        nav = TurnNavigation()
        nav.note_message("search_catalog", _search({"id": "cheap", "price": 1}))
        nav.note_message(
            "go_to_screen",
            '{"status": "ok", "screen": "search"}',
        )
        self.assertEqual(
            nav.callbacks(),
            [{"callback": "open_screen", "args": {"screen": "search"}}],
        )

    def test_unknown_screen_does_not_move(self):
        nav = TurnNavigation()
        nav.note_message("go_to_screen", '{"status": "unknown", "screen": "moon"}')
        self.assertEqual(nav.callbacks(), [])

    def test_message_draft_wins_over_a_named_screen(self):
        nav = TurnNavigation()
        nav.note_message("go_to_screen", '{"status": "ok", "screen": "inbox"}')
        moves = nav.callbacks(
            [
                {
                    "pending_tools": [
                        {
                            "name": "send_chat_message",
                            "args": {"conversation_id": "room-9", "text": "halo"},
                        }
                    ]
                }
            ]
        )
        self.assertEqual(
            moves,
            [{"callback": "open_chat", "args": {"conversationId": "room-9"}}],
        )

    def test_extract_callbacks_opens_the_searched_product(self):
        result = {
            "messages": [
                ToolMessage(
                    content=_search({"id": "cheap", "price": 1}, {"id": "other", "price": 9}),
                    name="search_catalog",
                    tool_call_id="t1",
                )
            ]
        }
        self.assertEqual(
            _extract_callbacks(result),
            [{"callback": "open_product", "args": {"productId": "cheap"}}],
        )


if __name__ == "__main__":
    unittest.main()
