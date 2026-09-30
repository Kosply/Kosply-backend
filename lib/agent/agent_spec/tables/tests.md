# tests — implemented

Run: `.venv/bin/python -m pytest tests/ -v` (85 passed, 4 skipped). No real AI
anywhere — `StatefulFakeChatModel` pops canned `AIMessage`s in order. One
folder per category; shared kit stays at `tests/base_test.py`.

| File | Cases | What it proves |
|---|---|---|
| `tests/base_test.py` | `StatefulFakeChatModel`, `BaseAgentTest.loop()` | fake (stateful, `bind_tools` → self, records inputs) + loop runner: `("send", text)` / `("approve", bool)` steps on one `thread_id` |
| `tests/message/test_fake_model.py` | order, fallback, input log, binding | canned replies pop in order; empty yields fallback; inputs logged; tools bind to self |
| `tests/message/test_canned.py` | helper shapes | answer/tool-call message structures match graph expectations |
| `tests/loop/test_loop.py` | bad steps, isolation | unknown steps raise; two threads keep separate histories |
| `tests/graph/test_graph.py` | plain answer | turn without tools answers directly |
| `tests/graph/test_graph.py` | interrupt → approve | `needs_approval` names the tool; resume runs it; final answer returned |
| `tests/graph/test_graph.py` | interrupt → reject | tool never runs (`Contact request queued` absent); rejection answer returned |
| `tests/graph/test_graph.py` | memory across turns | 2 sends on one thread → history ≥ 4 messages (resume works) |
| `tests/api/test_api.py` | health | `GET /health` → service name |
| `tests/api/test_api.py` | chat approval → resume | `POST /ai/chat` → `409`, `POST /ai/chat/resume` → `200` answer |
| `tests/api/test_api.py` | stream | SSE body contains `done` |
| `tests/api/test_api.py` | history | after one turn, roles include `human` + `ai` |
| `tests/api/test_wait.py` | wait resolve/timeout/noop | approval landing mid-wait returns `resolved` + `remainingS>0` + answer; no approval → `timeout` with `remainingS 0`; fresh thread → `noop` fast; route returns `noop` over HTTP |
| `tests/memory/test_history_store.py` | role mapping, off-mode | `AiMessageRole` mapping; silent no-op without `DATABASE_URL` |
| `tests/policy/test_policy.py` | injections rejected | 12 EN+ID samples refused with reason |
| `tests/policy/test_policy.py` | allowed + limits | Kosply talk passes; blanks/overlong refused |
| `tests/policy/test_policy.py` | prompt wiring | scope prompt is the first LLM input; prepend is idempotent |
| `tests/policy/test_policy.py` | route refusals | `200` + explainer, model untouched (chat + stream) |
| `tests/streaming/test_streaming.py` | split unit | plain/kwarg/blocks shapes split correctly |
| `tests/streaming/test_streaming.py` | thinking SSE | `thinking` event precedes the `token` |
| `tests/personas/test_personas.py` | mapping + wiring | seller/buyer/neutral modes reach the model; persist across turns |
| `tests/personas/test_personas.py` | route role | `POST /ai/chat` accepts `role` end to end |
| `tests/e2e/test_live_wiring.py` | live tools (opt-in `E2E_LIVE=1`) | search/detail hit the real server+DB; 404 surfaces as `ToolError` |
| `tests/e2e/test_live_lifecycle.py` | full lifecycle (opt-in `E2E_LIVE_AI=1`) | message → catalog tool → interrupt → approve → fresh instance remembers; temp user cleaned up |
| `tests/e2e/test_live_lifecycle.py` | approval wait (opt-in `E2E_LIVE_AI=1`) | 1500 s budget: reply at ~2 s → `resolved` + answer + `remainingS` > 1400 |

## Test-only notes

| Note | Details |
|---|---|
| ASGI transport | `httpx.ASGITransport` drives the real app (no TestClient portal); `app.state.graph` is replaced with a fake-backed graph |
| Dummy key | `OPENAI_API_KEY=test-dummy-key` in `base_test.py` so the lazy real model constructs at boot (never called) |
| SSE loop quirk | `reset_sse()` drops `sse-starlette`'s loop-bound global event before stream tests |
| Live shared loop | live classes extend `LiveTestCase` (class-scoped `asyncio.Runner`); the provider transport is bound to the first loop, so per-test loops would fail the second live test with `Event loop is closed` |
