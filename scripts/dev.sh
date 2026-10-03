#!/usr/bin/env bash
#
# @title Kosply local development stack
# @notice Boots Postgres, the Express server and the AI agent together, with
# @notice prefixed logs and a single ctrl-c that stops all of them.
# @dev The ordering matters and is the whole point of this script:
# @dev   1. Postgres must accept connections before anything queries it.
# @dev   2. The agent's tools call the server's `/api/internal/*` API, and the
# @dev      server 401s them without INTERNAL_API_KEY, so the server has to be
# @dev      up before the agent is useful -- but the agent boots fine without it.
# @dev   3. Migrations run before the server starts, because new code against an
# @dev      old schema shows up as "column does not exist" on live traffic.
#
# Usage: ./scripts/dev.sh [start|stop|status|logs|setup]
#
set -euo pipefail

# shellcheck source=_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
assert_repo

RUN_DIR="${TMPDIR:-/tmp}/kosply-dev"
SERVER_LOG="$RUN_DIR/server.log"
AGENT_LOG="$RUN_DIR/agent.log"
mkdir -p "$RUN_DIR"

usage() {
  cat <<'EOF'
Usage: ./scripts/dev.sh [command]

  setup     Install every dependency (db, root, agent) and apply migrations
  start     Start Postgres + server + agent in the background   (default)
  stop      Stop the server and the agent
  restart   Stop, then start
  status    Show what is running
  logs      Tail the server and agent logs
  reset     Drop the local schema, re-migrate, and re-seed

Environment
  PORT           server port (default 3000)
  AGENT_PORT     agent port  (default 8000)
EOF
}

write_pid() { echo "$2" > "$RUN_DIR/$1.pid"; }
read_pid() { [ -f "$RUN_DIR/$1.pid" ] && cat "$RUN_DIR/$1.pid" || echo ""; }

running() {
  local pid; pid="$(read_pid "$1")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

cmd_setup() {
  log "Installing dependencies"
  "$ROOT/scripts/db/db.sh" install
  log "Installing root dependencies"
  ( cd "$ROOT" && npm install )
  log "Installing the agent virtualenv"
  "$ROOT/scripts/agent/agent.sh" install
  log "Applying migrations"
  "$ROOT/scripts/db/db.sh" deploy
  ok "setup complete"
}

wait_for_db() {
  # Postgres may already be running from a previous session or compose.
  if wait_for_port localhost 5432 Postgres 3; then
    return 0
  fi
  require_cmd docker
  log "Starting Postgres"
  ( cd "$ROOT" && docker compose up -d postgres )
  wait_for_port localhost 5432 Postgres 60 || die "Postgres did not start"
}

cmd_start() {
  wait_for_db
  [ -d "$ROOT/node_modules" ] || die "root dependencies missing. Run: $0 setup"

  if running server; then warn "server already running (pid $(read_pid server))"; else
    log "Starting the server on :${PORT:-3000}"
    ( cd "$ROOT" && PORT="${PORT:-3000}" NODE_ENV=development \
        node lib/server/server.js ) >"$SERVER_LOG" 2>&1 &
    write_pid server $!
    wait_for_http "http://localhost:${PORT:-3000}/api/health" "server" 45 \
      || { tail -20 "$SERVER_LOG" >&2; die "the server did not become healthy"; }
  fi

  if running agent; then warn "agent already running (pid $(read_pid agent))"; else
    if [ -x "$ROOT/lib/agent/.venv/bin/uvicorn" ]; then
      log "Starting the agent on :${AGENT_PORT:-8000}"
      ( cd "$ROOT/lib/agent" && PORT="${AGENT_PORT:-8000}" \
          "$ROOT/lib/agent/.venv/bin/uvicorn" app.main:app \
          --host 127.0.0.1 --port "${AGENT_PORT:-8000}" --no-access-log ) \
        >"$AGENT_LOG" 2>&1 &
      write_pid agent $!
      wait_for_http "http://localhost:${AGENT_PORT:-8000}/health" "agent" 45 \
        || note "the agent is not answering /health yet; check $AGENT_LOG"
    else
      warn "agent virtualenv missing; skipping the agent. Run: $0 setup"
    fi
  fi

  echo
  ok "stack is up"
  note "server  http://localhost:${PORT:-3000}"
  note "agent   http://localhost:${AGENT_PORT:-8000}"
  note "logs    $RUN_DIR/{server,agent}.log   (./scripts/dev.sh logs)"
  echo
}

cmd_stop() {
  local name pid
  for name in server agent; do
    pid="$(read_pid "$name")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      # node --watch spawns a child; kill the whole group.
      pkill -P "$pid" 2>/dev/null || true
      kill "$pid" 2>/dev/null || true
      ok "stopped $name (pid $pid)"
    fi
    rm -f "$RUN_DIR/$name.pid"
  done
  note "Postgres left running on purpose; use: docker compose down"
}

cmd_status() {
  local name pid state
  for name in server agent; do
    pid="$(read_pid "$name")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then state="running (pid $pid)"; else state="stopped"; fi
    printf '  %-8s %s\n' "$name" "$state"
  done
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q kosply-postgres; then
    printf '  %-8s %s\n' "postgres" "running (docker)"
  else
    printf '  %-8s %s\n' "postgres" "stopped"
  fi
}

cmd_logs() { tail -n 40 -F "$SERVER_LOG" "$AGENT_LOG"; }

cmd_reset() {
  warn "This drops and recreates the local schema."
  "$ROOT/scripts/db/db.sh" reset
  "$ROOT/scripts/db/db.sh" seed
  ok "local database reset"
}

main() {
  load_env ""
  # `-h` / `--help` anywhere means help, even after a valid command:
  # `./scripts/dev.sh logs --help` must not fall through into `tail -F`.
  for arg in "$@"; do
    case "$arg" in
      -h|--help|help) usage; exit 0 ;;
    esac
  done
  local command="${1:-start}"
  shift || true
  case "$command" in
    setup)   cmd_setup "$@" ;;
    start)   cmd_start "$@" ;;
    stop)    cmd_stop "$@" ;;
    restart) cmd_stop; cmd_start "$@" ;;
    status)  cmd_status "$@" ;;
    logs)    cmd_logs "$@" ;;
    reset)   cmd_reset "$@" ;;
    ''|-h|--help|help) usage ;;
    *) usage >&2; die "unknown command: $command" ;;
  esac
}

main "$@"