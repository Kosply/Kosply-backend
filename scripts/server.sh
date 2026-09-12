#!/usr/bin/env bash
#
# @title Kosply server launcher (single entry)
# @notice Starts, stops, restarts or shows staging/main through one script.
# @dev Prefers the kosmon CLI when built (single logic source), otherwise
# @dev talks to PM2 directly so no Go toolchain is needed to boot a server.
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

usage() {
  echo "Usage: ./scripts/server.sh <staging|main> [start|stop|restart|status]"
  echo "  ./scripts/server.sh staging           # start staging (:3001)"
  echo "  ./scripts/server.sh main restart      # restart main (:3000)"
}

if [ "$ENV_NAME" != "staging" ] && [ "$ENV_NAME" != "main" ]; then
  usage >&2
  exit 1
fi

# Single logic source: kosmon when available.
if [ -x "$KOSMON" ]; then
  case "$ACTION" in
    start|stop|restart) exec "$KOSMON" "$ACTION" "$ENV_NAME" ;;
    status)             exec "$KOSMON" status ;;
    *) usage >&2; exit 1 ;;
  esac
fi

# Fallback: PM2 directly (kosmon not built yet).
APP="kosply-server-$ENV_NAME"
command -v pm2 >/dev/null 2>&1 || { echo "[error] pm2 is not installed and kosmon is not built. Run: npm i -g pm2"; exit 1; }
case "$ACTION" in
  start)
    if pm2 describe "$APP" >/dev/null 2>&1; then
      pm2 restart "$APP"
    else
      pm2 start ecosystem.config.js --only "$APP"
    fi
    pm2 status "$APP"
    ;;
  stop|restart) pm2 "$ACTION" "$APP" ;;
  status)       pm2 status ;;
  *) usage >&2; exit 1 ;;
esac
