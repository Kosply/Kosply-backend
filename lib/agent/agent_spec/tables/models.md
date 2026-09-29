# models registry — implemented

File: `app/agent/models/registry.py`. Provider metadata without hardcoding:
the agent asks the OpenAI-compatible `/v1/models` endpoint instead of
guessing model facts from config.

| Function | Does |
|---|---|
| `strip_provider` | drops client prefixes (`openai:foo` → `foo`) for lookup |
| `fetch_context_window` | returns the model's window (`context_length`, else `capabilities.contextWindow`); `None` when unknown/unreachable |
| `resolve_context_total` | explicit env wins → provider (cached per model id) → fallback 32000 |
| `clear_cache` | drops the process cache (tests only) |

## Rules

| Rule | Notes |
|---|---|
| Never crashes boot | unreachable providers resolve to the fallback with no exception |
| Single lookup | process cache means one `/v1/models` call per model id per boot |
| Pricing later | same endpoint pattern will feed `ai_models` prices (see `model_selector.md`) |
