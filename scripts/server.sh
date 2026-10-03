#!/usr/bin/env bash
#
# @title Kosply server launcher (single entry)
# @notice Starts, stops, restarts or shows staging/main through one script.
# @dev Prefers the kosmon CLI when built (single logic source), otherwise
# @dev talks to PM2 directly so no Go toolchain is needed to boot a server.
# @dev Applies pending Prisma migrations before the first start/restart. A
# @dev deploy used to ship new code against an old schema, surfacing as
# @dev "column does not exist" (P2022) on live traffic.
# @dev Rebuilds a stale kosmon binary when a .go file is newer, so the launcher
# @dev cannot silently run a CLI that predates the committed source.
#
# Usage: ./scripts/server.sh <staging|main> [start|stop|restart|status]
#
set -euo pipefail

# Resolve the project root (parent of this script's directory).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_NAME="${1:-}"
ACTION="${2:-start}"
KOSMON="$ROOT/lib/server-monitoring/kosmon"
APP="kosply-server-$ENV_NAME"

usage() {
  echo "Usage: ./scripts/server.sh <staging|main> [start|stop|restart|status]"
  echo "  ./scripts/server.sh staging           # start staging (:3001)"
  echo "  ./scripts/server.sh main restart      # restart main (:3000)"
}

if [ "$ENV_NAME" != "staging" ] && [ "$ENV_NAME" != "main" ]; then
  usage >&2
  exit 1
fi

# Resolve the database for the target environment.
# `DATABASE_URL` is main's; staging has its own. Using the ambient
# DATABASE_URL for a staging start applied main's migrations while booting
# staging — two environments, one (wrong) target.
db_url_for() {
  if [ "$ENV_NAME" = "staging" ]; then
    printf '%s' "${STAGING_DATABASE_URL:-${DATABASE_URL:-}}"
  else
    printf '%s' "${DATABASE_URL:-${STAGING_DATABASE_URL:-}}"
  fi
}

# Run pending migrations for the target environment's database.
# A missing DATABASE_URL is not fatal here: the DB-less CI smoke path boots the
# app in degraded mode on purpose.
migrate() {
  MIGRATE_URL="$(db_url_for)"
  if [ -z "$MIGRATE_URL" ]; then
    echo "[warn] no database URL for ${ENV_NAME}; skipping migrations"
    return 0
  fi
  if [ ! -d "$ROOT/lib/db/node_modules" ]; then
    echo "[error] lib/db dependencies are missing. Run: (cd lib/db && npm ci && npx prisma generate)"
    exit 1
  fi
  echo "[migrate] applying pending migrations to the ${ENV_NAME} database"
  ( cd "$ROOT/lib/db" && DATABASE_URL="$MIGRATE_URL" npx --no-install prisma migrate deploy )
  # The CHECK constraints can only be added once the tables exist, so they run
  # after migrate and are written to be idempotent.
  if command -v psql >/dev/null 2>&1; then
    echo "[migrate] applying data-integrity constraints"
    psql "$MIGRATE_URL" -q -v ON_ERROR_STOP=1 -f "$ROOT/lib/db/docker/checks.sql" || {
      echo "[warn] could not apply checks.sql (psql unavailable or DSN not understood); continuing"
    }
  fi
}

# A prebuilt binary that predates the source silently shadowed the Go code.
rebuild_kosmon_if_stale() {
  [ -x "$KOSMON" ] || return 0
  command -v go >/dev/null 2>&1 || return 0
  local newest_go
  newest_go="$(find "$ROOT/lib/server-monitoring" -name '*.go' -newer "$KOSMON" -print -quit 2>/dev/null || true)"
  if [ -n "$newest_go" ]; then
    echo "[kosmon] rebuilding (source is newer than the binary)"
    ( cd "$ROOT/lib/server-monitoring" && go build -o "$KOSMON" . )
  fi
}

rebuild_kosmon_if_stale

# Single logic source: kosmon when available.
if [ -x "$KOSMON" ]; then
  case "$ACTION" in
    start)
      migrate
      exec "$KOSMON" start "$ENV_NAME"
      ;;
    stop)    exec "$KOSMON" stop "$ENV_NAME" ;;
    restart)
      migrate
      exec "$KOSMON" restart "$ENV_NAME"
      ;;
    status)  exec "$KOSMON" status ;;
    *) usage >&2; exit 1 ;;
  esac
fi

# Fallback: PM2 directly (kosmon not built yet).
command -v pm2 >/dev/null 2>&1 || { echo "[error] pm2 is not installed and kosmon is not built. Run: npm i -g pm2"; exit 1; }
case "$ACTION" in
  start)
    migrate
    # `pm2 restart <name>` reuses PM2's *stored* config, so edits to the `env`
    # block (a new DATABASE_URL, a JWT_SECRET) were silently ignored. Use
    # startOrRestart against the config file, and --update-env so the current
    # shell environment reaches the process.
    pm2 startOrRestart ecosystem.config.js --only "$APP" --update-env
    pm2 status "$APP"
    ;;
  stop)     pm2 stop "$APP" ;;
  restart)
    migrate
    pm2 startOrRestart ecosystem.config.js --only "$APP" --update-env
    ;;
  status)   pm2 status ;;
  *) usage >&2; exit 1 ;;
esac
