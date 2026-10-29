"""Photo listing mode through the shipped FastAPI app and the stateful fake.

A chatbot turn stays on the existing path. A listing turn sends several
already-uploaded photo URLs beside the caption (the phone takes the photo,
uploads it, then hands the URL over). The card's title, description, and
category come from the model. Price and stock stay empty until the user
sends those two integers.
"""

import json

from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.base_test import BaseAgentTest, canned_answer
from tests.client import agent_headers

# Distinct from anything the user sends. If this shows up on the card, the
# model invented a price or a quantity.
_INVENTED_PRICE = 8675309
_INVENTED_STOCK = 42
_CAPTION = "jual barang ini"


def _side_url(name: str) -> str:
    """One uploaded photo URL. Three of these exceed the 4000-character text cap."""
    pad = "a" * 1400
    return f"https://cdn.kosply.test/uploads/{name}-{pad}.jpg"


def _photo_urls_seen(fake) -> list[str]:
    """Image URLs the fake model actually received. Not a card parser."""
    found = []
    for batch in fake.seen_inputs:
        for message in batch:
            content = getattr(message, "content", None)
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict) or block.get("type") != "image_url":
                    continue
                image = block.get("image_url") or {}
                url = image.get("url") if isinstance(image, dict) else None
                if url:
                    found.append(url)
    return found


class ListingModeTest(BaseAgentTest):
    """HTTP: chatbot turn, then a 3-photo listing, then price and stock."""

    def _client(self):
        return AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            headers=agent_headers(),
        )

    async def test_text_turn_has_no_listing_card(self):
        """A normal text turn answers and does not fill a product card."""
        reply = "Halo, COD dilakukan langsung dengan penjual."
        self.mount_fake([canned_answer(reply)])
        async with self._client() as client:
            res = await client.post(
                "/ai/chat",
                json={
                    "conversation_id": "c-list-chat",
                    "user_id": "u1",
                    "message": "halo, cara COD gimana?",
                },
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["answer"], reply)
        self.assertTrue(body["answer"].strip())
        self.assertFalse(body.get("listing"))

    async def test_photos_then_user_price_and_stock(self):
        """Three side photos make one card; price and stock arrive on the next turn."""
        photos = [_side_url("depan"), _side_url("samping"), _side_url("belakang")]
        self.assertGreater(len("".join(photos)), 4000)
        self.assertLess(len(_CAPTION), 4000)
        model = {
            "title": "Lampu belajar LED lipat",
            "description": "Lampu LED tiga sisi, nyala, kaki lipat masih kencang.",
            "category": "Peralatan Kos",
            "price": _INVENTED_PRICE,
            "stock": _INVENTED_STOCK,
        }
        self.mount_fake([canned_answer(json.dumps(model))])
        async with self._client() as client:
            listed = await client.post(
                "/ai/chat",
                json={
                    "conversation_id": "c-list-photo",
                    "user_id": "u1",
                    "message": _CAPTION,
                    "imageUrls": photos,
                },
            )
            self.assertEqual(listed.status_code, 200, listed.text)
            card = listed.json()["listing"]
            self.assertEqual(card["title"], model["title"])
            self.assertEqual(card["description"], model["description"])
            self.assertEqual(card["category"], model["category"])
            self.assertEqual(card["imageUrls"], photos)
            self.assertIsNone(card["price"])
            self.assertIsNone(card["stock"])
            self.assertNotIn(str(_INVENTED_PRICE), listed.json()["answer"])
            self.assertNotIn("sellerId", card)
            self.assertNotIn("status", card)
            self.assertEqual(_photo_urls_seen(self.fake_model), photos)
            # The price turn must not ask the model to invent a price.
            self.assertEqual(len(self.fake_model.seen_inputs), 1)

            priced = await client.post(
                "/ai/chat",
                json={
                    "conversation_id": "c-list-photo",
                    "user_id": "u1",
                    "price": 45000,
                    "stock": 2,
                },
            )
        self.assertEqual(priced.status_code, 200, priced.text)
        done = priced.json()["listing"]
        self.assertEqual(done["title"], model["title"])
        self.assertEqual(done["description"], model["description"])
        self.assertEqual(done["category"], model["category"])
        self.assertEqual(done["imageUrls"], photos)
        self.assertEqual(done["price"], 45000)
        self.assertEqual(done["stock"], 2)
        self.assertEqual(len(self.fake_model.seen_inputs), 1)
