# Kosply AI agent (Python 3.12). LangGraph deps are heavy, keep the image slim.
#
# Hardening (2026-09 audit pass):
#  - Runs as a non-root user. It previously ran as root, and it is the
#    highest-risk process in the stack: it ingests buyer-controlled text into an
#    LLM and holds a database credential.
#  - Base image pinned by digest and the build runs as root only to install.
#  - A HEALTHCHECK so an orchestrator is not told the service is fine when
#    uvicorn is wedged (compose defines one; the image did not).
#  - `.env` and `tests/` are deliberately NOT copied.
FROM python@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first so the layer caches.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Non-root, fixed uid so the compose `user:` directive matches.
RUN groupadd --system --gid 10001 agent \
 && useradd --system --uid 10001 --gid 10001 --home /app --shell /usr/sbin/nologin agent

COPY --chown=agent:agent app ./app

USER 10001:10001

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/health',timeout=4)"

# No --host 0.0.0.0 requirement in docs: the compose network is the only path in.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
