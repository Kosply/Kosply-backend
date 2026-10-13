#!/usr/bin/env bash
#
# @title Dashboard demo seed
# @notice One command to fill a DEV database with everything the admin
# @notice dashboard renders: the login-able operator account plus varied rows
# @notice for verifications, fraud reports, support tickets and AI models.
# @dev Placeholders below are intentional: this file is committed, so it must
# @dev never hold real credentials. Set your own values in `.env` (gitignored)
# @dev or pass them inline — `seed/index.js` loads `.env` with dotenv, and an
# @dev exported variable wins over the file, matching dotenv semantics.
# @dev Production guard lives in `seed/guard.js`: `NODE_ENV=production` is a
# @dev hard refusal and the database name must be a dev/test target
# @dev (kosply_dev | kosply_test | test).
#
#   ./seed.sh                 # everything (accounts + dashboard fixtures)
#   ./seed.sh accounts        # only the login-able operator account
#   ./seed.sh dashboard       # only the dashboard fixtures
#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/scripts/_common.sh"
assert_repo
require_cmd node

usage() {
  cat <<'EOF'
Usage: ./seed.sh [all|accounts|dashboard]

  all        seed the operator account and every dashboard fixture (default)
  accounts   seed only the login-able operator account
  dashboard  seed only the dashboard fixtures (skips the account)

Environment (set in .env or export inline):
  SEED_ADMIN_EMAIL     operator login email  (placeholder in this script)
  SEED_ADMIN_PASSWORD  operator password     (placeholder in this script)
  SEED_ADMIN_NAME      display name shown in the dashboard top bar

Placeholder values are intentionally not real; replace them before a demo that
needs a real login. See seed/README.md for the full fixture list.
EOF
}

MODE="${1:-all}"
case "$MODE" in
  all | accounts | dashboard) ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage
    die "unknown mode '$MODE'"
    ;;
esac

# Placeholder defaults — replace via .env or the environment. Never commit
# real credentials into this file.
SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@example.com}"
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-ChangeMe-123456}"
SEED_ADMIN_NAME="${SEED_ADMIN_NAME:-Ops Super Admin}"
export SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD SEED_ADMIN_NAME

if [ "$SEED_ADMIN_EMAIL" = "admin@example.com" ]; then
  warn "SEED_ADMIN_EMAIL is still the placeholder (admin@example.com)"
  note "set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in .env to seed your own account"
fi

cd "$ROOT"
log "seeding dashboard demo data (mode: $MODE)"
node seed/index.js "$MODE"
ok "seed finished"
