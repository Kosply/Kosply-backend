#!/bin/bash
# Entrypoint for Kosply's database bootstrap.
#
# The postgres image executes `/docker-entrypoint-initdb.d/*` on first start of
# an empty volume. It runs `.sql` files through `psql` with no arguments and
# `.sh` files as shell scripts, so this wrapper exists to pass `psql` the
# variables `01-init.sql` needs:
#
#   agent_password  the password for the least-privilege `kosply_agent` role.
#                   compose substitutes AGENT_DB_PASSWORD into the agent's
#                   DATABASE_URL; without this the role was created with a
#                   hardcoded literal that silently disagreed with it.
#
# Init only runs on an empty pgdata volume. Changing AGENT_DB_PASSWORD later
# needs `ALTER ROLE kosply_agent PASSWORD ...` (which 01-init.sql also does when
# it runs), so rotate it deliberately.
set -euo pipefail

# Mounted at /kosply-init/01-init.sql, NOT in docker-entrypoint-initdb.d: the
# image would otherwise execute it a second time directly, without -v.
SQL_FILE="${KOSPLY_INIT_DIR:-/kosply-init}/01-init.sql"

if [ ! -f "$SQL_FILE" ]; then
  echo "[init] FATAL: $SQL_FILE not found; mount lib/db/docker/init.sql at /kosply-init/" >&2
  exit 1
fi

: "${POSTGRES_USER:=kosply}"
: "${AGENT_DB_PASSWORD:=kosply}"

echo "[init] applying $(basename "$SQL_FILE")"
psql -v ON_ERROR_STOP=1 \
     -U "$POSTGRES_USER" \
     -d "${POSTGRES_DB:-$POSTGRES_USER}" \
     -v agent_password="$AGENT_DB_PASSWORD" \
     -f "$SQL_FILE"
echo "[init] done"