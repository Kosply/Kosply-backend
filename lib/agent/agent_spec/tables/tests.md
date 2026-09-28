# tests — implemented

Run: `.venv/bin/python -m pytest tests/ -v` (8 passed). No real AI anywhere —
`StatefulFakeChatModel` pops canned `AIMessage`s in order.

| File | Cases | What it proves |
|---|---|---|
| `tests/base_test.py` | `StatefulFakeChatModel`, `BaseAgentTest.loop()` | fake (stateful, `bind_tools` → self) + loop runner: `("send", text)` / `("approve", bool)` steps on one `thread_id` |
| `tests/test_graph.py` | plain answer | turn without tools answers directly |
| `tests/test_graph.py` | interrupt → approve | `needs_approval` names the tool; resume runs it; final answer returned |
| `tests/test_graph.py` | interrupt → reject | tool never runs (`Contact request queued` absent); rejection answer returned |
| `tests/test_graph.py` | memory across turns | 2 sends on one thread → history ≥ 4 messages (resume works) |
| `tests/test_api.py` | health | `GET /health` → service name |
| `tests/test_api.py` | chat approval → resume | `POST /ai/chat` → `409`, `POST /ai/chat/resume` → `200` answer |
| `tests/test_api.py` | stream | SSE body contains `done` |
| `tests/test_api.py` | history | after one turn, roles include `human` + `ai` |

## Test-only notes

| Note | Details |
|---|---|
| Lifespan graph swap | `TestClient` boots the real lifespan, then `app.state.graph` is replaced with a fake-backed graph |
| Dummy key | `OPENAI_API_KEY=test-dummy-key` so the lazy real model constructs at boot (never called) |
