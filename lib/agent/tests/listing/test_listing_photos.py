"""Own-upload photos reach the model as bytes; every other URL is untouched."""

import asyncio
import base64
import unittest

import httpx
from langchain_core.messages import AIMessage, HumanMessage

from app.agent.listing.photos import inline_own_uploads, own_upload_path
from app.core.config import settings

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def _photo(url: str) -> dict:
    return {"type": "image_url", "image_url": {"url": url}}


class OwnUploadPathTest(unittest.TestCase):
    """Only the exact path shape the upload route writes is recognised."""

    def test_matches_an_upload_on_any_host(self):
        self.assertEqual(
            own_upload_path("http://192.168.1.5:3000/uploads/ckx1abcd2345.png"),
            "/uploads/ckx1abcd2345.png",
        )

    def test_rejects_other_paths_and_shapes(self):
        for url in (
            "https://cdn.example.com/photo.png",
            "http://192.168.1.5:3000/uploads/../.env",
            "http://192.168.1.5:3000/uploads/ckx1abcd2345.png?x=1",
            "http://192.168.1.5:3000/uploads/ckx1abcd2345.gif",
            "file:///uploads/ckx1abcd2345.png",
            "http://192.168.1.5:3000/api/uploads/ckx1abcd2345.png",
        ):
            self.assertIsNone(own_upload_path(url), url)


class InlineOwnUploadsTest(unittest.TestCase):
    """The model copy gets data URLs; fetches go to KOSPLY_SERVER_URL only."""

    def _run(self, messages, handler):
        seen: list[str] = []

        def record(request: httpx.Request) -> httpx.Response:
            seen.append(str(request.url))
            return handler(request)

        async def go():
            async with httpx.AsyncClient(transport=httpx.MockTransport(record)) as client:
                return await inline_own_uploads(messages, client=client)

        return asyncio.run(go()), seen

    def test_own_upload_is_inlined_from_the_server_not_the_url_host(self):
        message = HumanMessage(
            content=[
                {"type": "text", "text": "foto barang"},
                _photo("http://192.168.1.5:3000/uploads/ckx1abcd2345.png"),
                _photo("https://cdn.example.com/elsewhere.jpg"),
            ]
        )
        out, seen = self._run([message], lambda request: httpx.Response(200, content=PNG))

        self.assertEqual(seen, [f"{settings.kosply_server_url}/uploads/ckx1abcd2345.png"])
        blocks = out[0].content
        self.assertEqual(blocks[0], {"type": "text", "text": "foto barang"})
        self.assertEqual(
            blocks[1]["image_url"]["url"],
            "data:image/png;base64," + base64.b64encode(PNG).decode("ascii"),
        )
        self.assertEqual(blocks[2]["image_url"]["url"], "https://cdn.example.com/elsewhere.jpg")
        # The original (checkpointed) message keeps its short URL.
        self.assertEqual(
            message.content[1]["image_url"]["url"],
            "http://192.168.1.5:3000/uploads/ckx1abcd2345.png",
        )

    def test_failed_fetch_keeps_the_url(self):
        url = "http://192.168.1.5:3000/uploads/ckx1abcd2345.jpg"
        out, _ = self._run(
            [HumanMessage(content=[_photo(url)])],
            lambda request: httpx.Response(404),
        )
        self.assertEqual(out[0].content[0]["image_url"]["url"], url)

    def test_non_photo_messages_pass_through(self):
        messages = [HumanMessage(content="halo"), AIMessage(content="hai")]
        out, seen = self._run(messages, lambda request: httpx.Response(200, content=PNG))
        self.assertEqual(seen, [])
        self.assertEqual([m.content for m in out], ["halo", "hai"])


if __name__ == "__main__":
    unittest.main()
