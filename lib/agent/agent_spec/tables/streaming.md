# streaming — implemented

File: `app/api/chat/streaming.py`. One graph run, two stream modes multiplexed:
`messages` (tokens) + `updates` (interrupts).

| Event | Payload | When |
|---|---|---|
| `token` | `{"text": "..."}` | each LLM answer chunk |
| `thinking` | `{"text": "..."}` | each reasoning-model thinking chunk (render collapsed/hidden) |
| `interrupt` | `{"pending": [...]}` | graph paused for approval — client must call `POST /ai/chat/resume`; stream ends here |
| `done` | `{"ok": true, "listing"?}` | turn finished without interrupt. `listing` is present only when this turn produced a product card |

## Thinking split (`split_thinking`)

| Shape | Detected as thinking |
|---|---|
| `content_blocks` reasoning/thinking/redacted blocks | `thinking` / `reasoning` / `text` keys |
| `non_standard` wrapper | unwrapped recursively, then as above |
| `additional_kwargs.reasoning_content` | appended unless already present (dedupe) |
| plain text blocks / strings | answer (`token`) |

## Notes

| Note | Details |
|---|---|
| Transport | SSE via `EventSourceResponse` (`POST /ai/chat/stream`) |
| Serialization | payloads pre-serialized with `json.dumps` (safe across `sse-starlette` versions) |
| Empty chunks | non-string / empty token chunks are skipped |
| Hidden messages | `tool`, `system`, and `human` messages are not `token` or `thinking` events. Callbacks stay on the `callback` event |
