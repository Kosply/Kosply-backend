#!/usr/bin/env bash
#
# @title Drift gate (column registry vs migration history)
# @notice Replays the committed migrations into a scratch database and checks
# @notice that every column the app reads or writes actually exists there.
# @dev Used by `./scripts/db/db.sh drift` and by CI, so the local and the CI
# @dev answer to "does the migration history still describe the schema?" cannot
# @dev drift apart.
# @dev What replaced the old check: the previous version diffed a hand-written
# @dev Prisma datamodel against a shadow database. There is no datamodel now —
# @dev `schema.js` lists the columns the application touches, which is a
# @dev *different and stronger* question: "can every query in the app succeed
# @dev against a database built purely from the migrations?"
# @dev A column present in MariaDB but absent from `schema.js` is also reported,
# @dev because that means a table grew a column nobody declared — the same drift
# @dev in the other direction.
# @dev This runs against a *scratch* database. It never touches DATABASE_URL:
# @dev replaying migrations into a live environment is not a read-only operation.
#
# Usage: ./scripts/db/schema-diff.sh check
#   exit 0 when there is no drift, 2 when there is
#
# Env:
#   SHADOW_DATABASE_URL   empty database to replay into; defaults to the same
#                         server and credentials with the database name
#                         `kosply_shadow`, which docker/init.sh provisions
#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../_common.sh"
assert_repo

DB_DIR="$ROOT/lib/db"

mode="${1:-check}"
case "$mode" in
  check) ;;
  *) echo "usage: $0 check" >&2; exit 2 ;;
esac

[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL is not set" >&2; exit 2; }

shadow="${SHADOW_DATABASE_URL:-}"
if [ -z "$shadow" ]; then
  # Same server, same credentials, dedicated shadow database: the app role has
  # no global CREATE privilege (see docker/init.sh), so nothing here may invent
  # a database of its own.
  shadow="${DATABASE_URL%%\?*}"
  shadow="${shadow%/*}/kosply_shadow"
fi

cd "$DB_DIR"
exec node src/drift.js "$shadow"