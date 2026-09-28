"""Rate limiting: sliding-window, per user (body) or IP fallback.

Single-process scope (dict + monotonic clock): correct behind one uvicorn
worker. Multi-worker / multi-replica deployments need Redis — marked TODO.
Abuse answers 429 with a stable code Flutter can honor with backoff.
"""

import json
import time
from collections import deque

from starlette.responses import JSONResponse


class RateLimiter:
    """Fixed-cap sliding window counter."""

    def __init__(self, max_requests: int, window_seconds: float = 60.0) -> None:
        self.max_requests = max(1, max_requests)
        self.window = max(1.0, window_seconds)
        self._hits: dict[str, deque] = {}

    def allowed(self, key: str) -> bool:
        """Record a hit; False when the key already spent its budget."""
        now = time.monotonic()
        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= self.window:
            hits.popleft()
        if len(hits) >= self.max_requests:
            return False
        hits.append(now)
        if len(self._hits) > 10000:
            self._hits.pop(next(iter(self._hits)))
        return True


def _request_key(request, body: bytes) -> str:
    """Prefer the authenticated user id from JSON bodies, else client IP."""
    try:
        payload = json.loads(body.decode("utf-8")) if body else {}
    except (ValueError, UnicodeDecodeError):
        payload = {}
    user_id = payload.get("user_id") if isinstance(payload, dict) else None
    if user_id:
        return f"user:{user_id}"
    client = request.client.host if request.client else "unknown"
    return f"ip:{client}"


def rate_limit_middleware(limiter: RateLimiter):
    """Build ASGI middleware enforcing the limiter on `/ai/*` only."""

    async def middleware(request, call_next):
        if not request.url.path.startswith("/ai/"):
            return await call_next(request)
        body = await request.body()  # cached by Starlette; downstream reuses it
        if not limiter.allowed(_request_key(request, body)):
            return JSONResponse(
                status_code=429,
                content={"status": "error", "code": "RATE_LIMITED",
                         "message": "Too many requests, slow down."},
            )
        return await call_next(request)

    return middleware
