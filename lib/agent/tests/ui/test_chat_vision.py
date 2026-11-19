"""Photos on a chat turn stay with the assistant instead of the listing card."""

import unittest

from app.api.chat.schemas import ChatRequest
from app.api.chat.turn import graph_input, listing_mode_of


class ChatVisionTest(unittest.TestCase):
    """`see_photos` attaches pictures without ending the conversation."""

    def _request(self, *, see: bool) -> ChatRequest:
        return ChatRequest(
            conversation_id="thread-1",
            user_id="user-1",
            message="isi formnya",
            image_urls=["https://cdn.kosply.test/uploads/side.jpg"],
            see_photos=see,
        )

    def test_listing_card_turn_still_takes_bare_photos(self):
        req = self._request(see=False)
        self.assertEqual(listing_mode_of(req), "photos")
        state = graph_input(req)
        self.assertEqual(state["listing_mode"], "photos")
        self.assertEqual(state["image_urls"], ["https://cdn.kosply.test/uploads/side.jpg"])

    def test_see_photos_stays_on_the_chatbot_and_keeps_the_picture(self):
        req = self._request(see=True)
        self.assertEqual(listing_mode_of(req), "chat")
        state = graph_input(req)
        self.assertEqual(state["listing_mode"], "chat")
        self.assertEqual(state["image_urls"], [])
        blocks = state["messages"][0].content
        self.assertEqual(blocks[0]["type"], "text")
        self.assertEqual(blocks[1]["type"], "image_url")
        self.assertEqual(
            blocks[1]["image_url"]["url"],
            "https://cdn.kosply.test/uploads/side.jpg",
        )
