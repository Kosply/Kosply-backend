"""Pytest bootstrap: environment must be set before any app import.

`app.core.config` snapshots the environment at import time, so the internal
key has to exist before `app.main` is loaded.
"""

import os

# The agent now requires a shared key on every /ai/* route. Tests get one by
# default; the security suite also asserts that an unset key fails closed.
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key")
os.environ.setdefault("OPENAI_API_KEY", "test-dummy-key")
