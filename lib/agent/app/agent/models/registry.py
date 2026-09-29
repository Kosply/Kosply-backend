"""Model registry helpers: provider metadata without hardcoding.

Reads the OpenAI-compatible `/v1/models` endpoint so the agent learns real
model facts (context window today; pricing later) instead of config guesses.
Results are cached per model id for the process lifetime.
"""

import httpx

FALLBACK_TOTAL = 32000

_cache: dict = {}


def strip_provider(model_ref: str) -> str:
    """Drop the client prefix (`openai:foo` -> `foo`) for provider lookup."""
    ref = str(model_ref or "")
    return ref.split(":", 1)[1] if ":" in ref else ref


def fetch_context_window(model_id: str, *, base_url: str, api_key: str,
                         timeout_s: float = 10.0) -> int | None:
    """Ask the provider for one model's context window. None when unknown."""
    try:
        resp = httpx.get(f"{base_url.rstrip('/')}/v1/models",
                         headers={"Authorization": f"Bearer {api_key}"},
                         timeout=timeout_s)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None
    items = data.get("data", []) if isinstance(data, dict) else []
    for item in items:
        if not isinstance(item, dict) or item.get("id") != model_id:
            continue
        for candidate in (item.get("context_length"),
                          (item.get("capabilities") or {}).get("contextWindow")):
            try:
                total = int(candidate)
            except (TypeError, ValueError):
                continue
            if total > 0:
                return total
    return None


def resolve_context_total(model_ref: str, *, explicit: int,
                          base_url: str, api_key: str) -> int:
    """Total window tokens: explicit env wins, else provider, else fallback."""
    if explicit and explicit > 0:
        return explicit
    key = strip_provider(model_ref)
    if key not in _cache:
        found = fetch_context_window(
            key, base_url=base_url or "", api_key=api_key or "") if base_url else None
        _cache[key] = found or FALLBACK_TOTAL
    return _cache[key]


def clear_cache() -> None:
    """Drop cached lookups (tests only)."""
    _cache.clear()
