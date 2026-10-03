#!/usr/bin/env bash
#
# @title Kosply AI agent workflows (lib/agent)
# @notice Create the venv, run the agent locally, and run its test-suite.
# @dev The agent loads `.env` relative to its own CWD, so these scripts export
# @dev the repository `.env` into the child process instead of relying on it.
# @dev Without that, starting the agent from the repository root silently used
# @dev an empty configuration.
#
# Usage: ./scripts/agent/agent.sh <command> [args]
#
set -euo pipefail

# shellcheck source=../_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../_common.sh"
assert_repo

AGENT_DIR="$ROOT/lib/agent"
VENV="$AGENT_DIR/.venv"
PY="$VENV/bin/python"

usage() {
  cat <<'EOF'
Usage: ./scripts/agent/agent.sh <command>

Setup
  install          Create .venv and install runtime + dev requirements
  install:prod     Runtime requirements only
  shell            Open a shell inside the venv

Run
  dev              uvicorn with --reload on $PORT (default 8000)
  start            uvicorn without --reload (what the container runs)
  test             Run the pytest suite
  test:watch       Re-run tests on change
  clean            Remove __pycache__ directories and .pytest_cache
EOF
}

require_installed() {
  [ -x "$PY" ] || die "agent virtualenv missing. Run: $0 install"
}

# The agent's own config loader reads `.env` from the CWD, so point it at the
# one place the whole repository agrees on.
agent_env() {
  if [ -f "$AGENT_DIR/.env" ]; then
    echo "$AGENT_DIR/.env"
  else
    echo "$ROOT/.env"
  fi
}

cmd_install() {
  require_cmd python3
  [ -d "$VENV" ] || {
    log "Creating the virtualenv"
    python3 -m venv "$VENV"
  }
  log "Installing runtime requirements"
  "$PY" -m pip install --quiet --upgrade pip
  "$PY" -m pip install --quiet -r "$AGENT_DIR/requirements.txt"
  if [ "${1:-}" = "prod" ]; then
    ok "runtime requirements installed"
    return 0
  fi
  log "Installing development requirements"
  "$PY" -m pip install --quiet -r "$AGENT_DIR/requirements-dev.txt"
  ok "virtualenv ready at ${VENV#"$ROOT"/}"
}

cmd_shell() {
  require_installed
  # shellcheck disable=SC1091
  . "$VENV/bin/activate"
  cd "$AGENT_DIR"
  exec "${SHELL:-bash}"
}

cmd_dev() {
  require_installed
  local env_file; env_file="$(agent_env)"
  [ -f "$env_file" ] || die "no .env found (looked in $AGENT_DIR and $ROOT)"
  # Required on every /ai/* route. Fail loudly rather than starting an agent
  # that answers 401 to all six of its own tools.
  local key; key="$(grep -E '^INTERNAL_API_KEY=' "$env_file" | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
  [ -n "$key" ] || die "INTERNAL_API_KEY is not set in $env_file; the agent cannot call the server"
  log "Starting the agent on :${PORT:-8000} (reload enabled)"
  ( cd "$AGENT_DIR" && exec "$VENV/bin/uvicorn" app.main:app \
      --host 127.0.0.1 --port "${PORT:-8000}" --reload --no-access-log )
}

cmd_start() {
  require_installed
  local env_file; env_file="$(agent_env)"
  log "Starting the agent on :${PORT:-8000}"
  ( cd "$AGENT_DIR" && exec "$VENV/bin/uvicorn" app.main:app \
      --host 0.0.0.0 --port "${PORT:-8000}" --no-access-log )
}

cmd_test() {
  require_installed
  log "Running the agent test-suite"
  ( cd "$AGENT_DIR" && "$PY" -m pytest tests/ "${@:-}" -q )
}

cmd_test_watch() {
  require_installed
  log "Watching for changes (ctrl-c to stop)"
  if [ ! -x "$VENV/bin/pytest-watch" ]; then
    "$PY" -m pip install --quiet pytest-watch
  fi
  ( cd "$AGENT_DIR" && "$VENV/bin/pytest-watch" tests/ -q )
}

cmd_clean() {
  log "Removing caches"
  find "$AGENT_DIR" -path "$VENV" -prune -o -name '__pycache__' -type d -print0 \
    | xargs -0 --no-run-if-empty rm -rf
  rm -rf "$AGENT_DIR/.pytest_cache"
  ok "caches removed (the virtualenv was left alone)"
}

main() {
  load_env "$(agent_env)"
  local command="${1:-}"
  shift || true
  case "$command" in
    install)      cmd_install "$@" ;;
    'install:prod') cmd_install prod ;;
    shell)        cmd_shell "$@" ;;
    dev)          cmd_dev "$@" ;;
    start)        cmd_start "$@" ;;
    test)         cmd_test "$@" ;;
    'test:watch') cmd_test_watch "$@" ;;
    clean)        cmd_clean "$@" ;;
    ''|-h|--help|help) usage ;;
    *) usage >&2; die "unknown command: $command" ;;
  esac
}

main "$@"