#!/usr/bin/env bash
#
# @title MariaDB-aware Prisma schema diff (migrations vs schema.db)
# @notice Replays the committed migrations into a shadow database and diffs the
# @notice result against lib/db/schema/schema.db.
# @dev Used by `./scripts/db/db.sh drift|migrate` and by CI, so the local and
# @dev the CI answer to "does the migration history still describe the schema?"
# @dev cannot drift apart.
#
# Usage: ./scripts/db/schema-diff.sh check|script
#   check   exit 0 when there is no drift, 2 when there is (prisma's --exit-code)
#   script  print the SQL that would close the drift
#
# Env:
#   DATABASE_URL          the application database (for the datasource block)
#   SHADOW_DATABASE_URL   empty database to replay migrations into; defaults to
#                         the same server and credentials with the database name
#                         `kosply_shadow`, which docker/init.sh provisions
#
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../_common.sh"
assert_repo

DB_DIR="$ROOT/lib/db"
SCHEMA_FILE="$DB_DIR/schema/schema.db"
MIGRATIONS_DIR="$DB_DIR/schema/migrations"

mode="${1:-check}"
case "$mode" in
  check|script) ;;
  *) echo "usage: $0 check|script" >&2; exit 2 ;;
esac

[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL is not set" >&2; exit 2; }

# Why this script exists at all: MariaDB has no JSON type. It stores JSON as
# LONGTEXT plus a json_valid() CHECK constraint, and Prisma's introspection
# reports such a column as `String @db.LongText`. Diffing the hand-written
# datamodel (`Json`) against a MariaDB-built schema therefore reports every
# JSON column as "type changed" forever, and `prisma migrate dev` would keep
# generating no-op migrations (`MODIFY COLUMN imageUrls JSON NOT NULL`).
#
# The comparison is therefore made against the datamodel with its `Json`
# scalars rewritten to the type MariaDB actually stores. The stored values stay
# JSON (docker/checks.sql keeps the json_valid() guarantee) and the Prisma
# Client keeps doing the encode/decode.
normalized="$(mktemp --suffix=.db)"
trap 'rm -f "$normalized"' EXIT
perl -pe 's/\bJson\?/String? \@db.LongText/g; s/\bJson\b/String \@db.LongText/g' \
  "$SCHEMA_FILE" > "$normalized"

shadow="${SHADOW_DATABASE_URL:-}"
if [ -z "$shadow" ]; then
  # Same server, same credentials, dedicated shadow database: the app role has
  # no global CREATE privilege (see docker/init.sh), so Prisma cannot invent
  # `prisma_migrate_shadow_db_<hash>` for itself.
  shadow="${DATABASE_URL%%\?*}"
  shadow="${shadow%/*}/kosply_shadow"
fi

extra=(--script)
[ "$mode" = "check" ] && extra=(--exit-code)

cd "$DB_DIR"
exec npx --no-install prisma migrate diff \
  --from-migrations "$MIGRATIONS_DIR" \
  --to-schema-datamodel "$normalized" \
  --shadow-database-url "$shadow" \
  "${extra[@]}"