#!/usr/bin/env bash
#
# @title Kosply database workflows (lib/db)
# @notice Install, migrate, seed and inspect the Prisma schema and MariaDB.
# @dev `migrate deploy` (not `migrate dev`) is what any shared environment uses:
# @dev `migrate dev` can reset a database when it decides the schema drifted,
# @dev which on staging or main is data loss. `dev` here is reserved for a local
# @dev scratch database and says so.
# @dev `migrate <name>` does not shell out to `prisma migrate dev` either: on
# @dev MariaDB that creates and drops its own shadow database, which needs a
# @dev global CREATE privilege the application role deliberately does not have.
# @dev It uses the same explicit-shadow diff as CI (scripts/db/schema-diff.sh).
#
# Usage: ./scripts/db/db.sh <command> [args]
#
set -euo pipefail

# shellcheck source=../_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../_common.sh"
assert_repo

DB_DIR="$ROOT/lib/db"

usage() {
  cat <<'EOF'
Usage: ./scripts/db/db.sh <command>

Setup
  install          npm ci in lib/db, then generate the Prisma client
  generate         Regenerate the Prisma client (run after editing schema.db)

Schema
  validate         Check schema.db without touching a database
  migrate <name>   Create + apply a migration from schema.db (LOCAL ONLY)
  deploy           Apply pending migrations (use this for staging/main)
  status           Show which migrations have been applied
  reset            Drop the schema and re-apply every migration (DESTRUCTIVE)
  drift            Fail if the schema and the migrations disagree
  format           Format schema.db

Data
  seed             Insert demo users/products (refuses a production database)
  studio           Open Prisma Studio

Local database
  testdb           Create a throwaway database, migrate it, and print its URL
  up / down        Start / stop the project's MariaDB via docker compose
EOF
}

# Run prisma from lib/db with the repository env loaded.
# The schema lives at schema/schema.db (not Prisma's default prisma/schema.prisma),
# so every invocation passes an explicit --schema.
SCHEMA_FILE="$DB_DIR/schema/schema.db"
MIGRATIONS_DIR="$DB_DIR/schema/migrations"

schema_diff() {
  "$ROOT/scripts/db/schema-diff.sh" "$@"
}

prisma() {
  ( cd "$DB_DIR" && npx --no-install prisma "$@" --schema "$SCHEMA_FILE" )
}

# Prisma resolves the datasource block before it decides what the command
# actually needs, so even `validate` (purely static) fails with P1012 when
# DATABASE_URL is absent. Hand it a syntactically valid placeholder: it is
# never used to reach a database.
prisma_static() {
  ( cd "$DB_DIR" && DATABASE_URL="${DATABASE_URL:-mysql://x:x@localhost:3306/x}" \
      npx --no-install prisma "$@" --schema "$SCHEMA_FILE" )
}

require_installed() {
  [ -d "$DB_DIR/node_modules" ] \
    || die "lib/db dependencies missing. Run: ./scripts/db/db.sh install"
}

require_db_url() {
  [ -n "${DATABASE_URL:-}" ] \
    || die "DATABASE_URL is not set. Copy .env.example to .env and fill it in."
}

cmd_install() {
  require_cmd npm
  log "Installing lib/db dependencies"
  ( cd "$DB_DIR" && npm ci )
  cmd_generate
}

cmd_generate() {
  require_installed
  log "Generating the Prisma client"
  prisma generate
  ok "client generated"
}

cmd_validate() {
  require_installed
  log "Validating schema.db"
  prisma_static validate
}

cmd_format() {
  require_installed
  log "Formatting schema.db"
  prisma_static format
}

cmd_migrate() {
  require_installed
  require_db_url
  local name="${1:-}"
  [ -n "$name" ] || die "usage: $0 migrate <name>   (e.g. $0 migrate add_promo_codes)"
  warn "This applies migrations to the database in DATABASE_URL."
  warn "Use '$0 deploy' for staging or main."
  # Not `prisma migrate dev`: on MariaDB it creates and drops its own shadow
  # database (`prisma_migrate_shadow_db_<hash>`), which needs a global CREATE
  # privilege the application role deliberately does not have (it is also a
  # licence to drop kosply_main). The explicit-shadow workflow below is the same
  # one CI runs, against the kosply_shadow database init.sh provisions.
  local sql dir
  sql="$(schema_diff script)" || die "could not diff the migrations against schema.db"
  [ -n "$sql" ] || die "schema.db already matches the migrations: nothing to migrate"
  dir="$MIGRATIONS_DIR/$(date -u +%Y%m%d%H%M%S)_$name"
  mkdir -p "$dir"
  printf '%s\n' "$sql" > "$dir/migration.sql"
  ok "created $(basename "$dir")"
  log "Applying it"
  prisma migrate deploy
  # `migrate deploy` does not regenerate the client, and `migrate dev` used to.
  cmd_generate
}

cmd_deploy() {
  require_installed
  require_db_url
  log "Applying pending migrations"
  prisma migrate deploy
  # The CHECK constraints live outside the migrations because they need the
  # tables to exist first; checks.sql is written to be idempotent.
  # `prisma db execute` reads DATABASE_URL itself, so this works with a MariaDB
  # URL without needing a mysql/psql client on the host.
  log "Applying data-integrity constraints"
  prisma db execute --file "$DB_DIR/docker/checks.sql" \
    || warn "checks.sql did not apply (the DSN is not understood?)"
  ok "database is up to date"
}

cmd_status() {
  require_installed
  require_db_url
  prisma migrate status
}

cmd_reset() {
  require_installed
  require_db_url
  # A typo here is unrecoverable, so make it deliberate.
  printf 'This DROPS AND RECREATES the schema in %s.\n' "$DATABASE_URL"
  printf 'Type the database name to confirm: '
  local answer; read -r answer
  local db_name; db_name="$(basename "${DATABASE_URL%%\?*}")"
  [ "$answer" = "$db_name" ] || die "aborted: '$answer' != '$db_name'"
  log "Resetting the schema"
  prisma migrate reset --force --skip-seed
  ok "schema reset"
}

cmd_drift() {
  require_installed
  require_db_url
  # CI runs exactly this (scripts/db/schema-diff.sh check): a migration that
  # does not reproduce the schema is a latent P2022 ("column does not exist")
  # the first time it runs.
  log "Checking for drift between the migrations and schema.db"
  if schema_diff check; then
    ok "no drift"
  else
    die "drift detected: the migrations do not produce schema.db"
  fi
}

cmd_seed() {
  require_installed
  require_db_url
  log "Seeding demo data"
  ( cd "$DB_DIR" && node schema/seed.js )
  ok "seeded"
}

cmd_studio() {
  require_installed
  require_db_url
  log "Opening Prisma Studio"
  prisma studio
}

cmd_testdb() {
  require_cmd docker
  require_installed
  local name="${1:-kosply_scratch}"
  local url="mysql://kosply:kosply@localhost:3306/${name}"
  log "Creating scratch database '$name' and migrating it"
  if ! docker ps >/dev/null 2>&1; then
    die "docker is not running"
  fi
  local root_pw="${MARIADB_ROOT_PASSWORD:-}"
  docker exec kosply-mariadb mariadb -uroot ${root_pw:+-p"$root_pw"} -e "DROP DATABASE IF EXISTS \`$name\`" >/dev/null 2>&1 || true
  docker exec kosply-mariadb mariadb -uroot ${root_pw:+-p"$root_pw"} -e "CREATE DATABASE \`$name\`" >/dev/null
  DATABASE_URL="$url" prisma migrate deploy
  ok "scratch database ready"
  echo
  echo "  DATABASE_URL=\"$url\""
  echo
}

cmd_up() {
  require_cmd docker
  log "Starting MariaDB via docker compose"
  docker compose up -d mariadb
  wait_for_port localhost 3306 MariaDB 60 || true
}

cmd_down() {
  require_cmd docker
  log "Stopping docker compose services"
  docker compose down
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
  local command="${1:-}"
  shift || true
  case "$command" in
    install)         cmd_install "$@" ;;
    generate)        cmd_generate "$@" ;;
    validate)        cmd_validate "$@" ;;
    format)          cmd_format "$@" ;;
    migrate)         cmd_migrate "$@" ;;
    deploy)          cmd_deploy "$@" ;;
    status)          cmd_status "$@" ;;
    reset)           cmd_reset "$@" ;;
    drift)           cmd_drift "$@" ;;
    seed)            cmd_seed "$@" ;;
    studio)          cmd_studio "$@" ;;
    testdb)          cmd_testdb "$@" ;;
    up)              cmd_up "$@" ;;
    down)            cmd_down "$@" ;;
    ''|-h|--help|help) usage ;;
    *) usage >&2; die "unknown command: $command" ;;
  esac
}

main "$@"