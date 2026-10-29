"""Direct calls to the card assembler the listing turn uses."""

import json
import unittest

from app.agent.listing.card import (
    CATEGORY_MAX,
    DESCRIPTION_MAX,
    MAX_IMAGES,
    TITLE_MAX,
    ListingCardError,
    assemble_listing_card,
)


def _model(**overrides) -> str:
    data = {
        "title": "Lampu belajar LED lipat",
        "description": "Lampu LED tiga sisi, nyala, kaki lipat masih kencang.",
        "category": "barang aneh sekali",
        "price": 8675309,
        "stock": 42,
    }
    data.update(overrides)
    return json.dumps(data)


class ListingCardTest(unittest.TestCase):
    """Field contract: AI text, user price and stock, 8-photo cap."""

    def test_model_fills_text_and_does_not_set_price_or_stock(self):
        photos = [
            "https://cdn.kosply.test/uploads/depan.jpg",
            "https://cdn.kosply.test/uploads/samping.jpg",
            "https://cdn.kosply.test/uploads/belakang.jpg",
        ]
        card = assemble_listing_card(photos, _model())
        self.assertEqual(card["title"], "Lampu belajar LED lipat")
        self.assertEqual(
            card["description"],
            "Lampu LED tiga sisi, nyala, kaki lipat masih kencang.",
        )
        # Free text, not a fixed category enum.
        self.assertEqual(card["category"], "barang aneh sekali")
        self.assertEqual(card["imageUrls"], photos)
        self.assertIsNone(card["price"])
        self.assertIsNone(card["stock"])
        self.assertEqual(
            set(card),
            {"title", "description", "category", "imageUrls", "price", "stock"},
        )

    def test_user_price_and_stock_keep_the_ai_text(self):
        photos = [
            "https://cdn.kosply.test/uploads/depan.jpg",
            "https://cdn.kosply.test/uploads/samping.jpg",
        ]
        draft = assemble_listing_card(photos, _model())
        done = assemble_listing_card(
            draft["imageUrls"],
            None,
            price=125000,
            stock=2,
            previous=draft,
        )
        self.assertEqual(done["title"], draft["title"])
        self.assertEqual(done["description"], draft["description"])
        self.assertEqual(done["category"], draft["category"])
        self.assertEqual(done["imageUrls"], draft["imageUrls"])
        self.assertEqual(done["price"], 125000)
        self.assertEqual(done["stock"], 2)

    def test_eight_photos_fit_and_the_ninth_is_not_stored(self):
        eight = [f"https://cdn.kosply.test/side/{i}.jpg" for i in range(MAX_IMAGES)]
        nine = eight + ["https://cdn.kosply.test/side/ninth.jpg"]
        card8 = assemble_listing_card(eight, _model())
        card9 = assemble_listing_card(nine, _model())
        self.assertEqual(card8["imageUrls"], eight)
        self.assertEqual(len(card8["imageUrls"]), 8)
        self.assertEqual(card9["imageUrls"], eight)
        self.assertNotIn("https://cdn.kosply.test/side/ninth.jpg", card9["imageUrls"])

    def test_text_is_clipped_to_the_product_write_limits(self):
        card = assemble_listing_card(
            ["https://cdn.kosply.test/side/0.jpg"],
            _model(
                title="T" * (TITLE_MAX + 40),
                description="D" * (DESCRIPTION_MAX + 25),
                category="K" * (CATEGORY_MAX + 30),
            ),
        )
        self.assertEqual(len(card["title"]), TITLE_MAX)
        self.assertEqual(len(card["description"]), DESCRIPTION_MAX)
        self.assertEqual(len(card["category"]), CATEGORY_MAX)
        self.assertIsNone(card["price"])
        self.assertIsNone(card["stock"])

    def test_user_price_rejects_bool_and_float(self):
        photos = ["https://cdn.kosply.test/side/0.jpg"]
        text = _model()
        with self.assertRaises(ListingCardError):
            assemble_listing_card(photos, text, price=True, stock=1)
        with self.assertRaises(ListingCardError):
            assemble_listing_card(photos, text, price=1500, stock=1.5)
