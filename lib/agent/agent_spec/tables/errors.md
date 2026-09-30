# errors — implemented

File: `app/core/errors/errors.py`. One hierarchy, one handler registration —
routes only raise, never format responses.

| Class | HTTP | When |
|---|---|---|
| `AgentError` | `500` | base; `{status: error, message}` |
| `ModelError` | `500` | LLM call failed (missing key, provider down, bad model id) |
| `ToolError` | `500` | catalog / internal API tool failed |
| `MemoryError` | `500` | checkpointer setup failed (boot-time, fail fast) |
| `ApprovalRequired` | `409` | interrupt payload → `{status: needs_approval, interrupt: [...]}` |

## Rules

| Rule | Notes |
|---|---|
| Raise, don't format | `register_exception_handlers(app)` in `main.py` owns all JSON mapping |
| Approval is not an error | `409` is a normal control-flow signal for the Flutter approval UI |
