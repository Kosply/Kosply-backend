#!/usr/bin/env bash
#
# @title Kosply database workflows (lib/db)
# @notice Install, migrate, seed and inspect the Prisma schema and Postgres.
# @dev `migrate deploy` (not `migrate dev`) is what any shared environment uses:
# @dev `migrate dev` can reset a database when it decides the schema drifted,
# @dev which on staging or main is data loss. `dev` here is reserved for a local
# @dev scratch database and says so.
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
  generate         Regenerate the Prisma client (run after editing schema.prisma)

Schema
  validate         Check schema.prisma without touching a database
  migrate          Create + apply a migration from schema.prisma (LOCAL ONLY)
  deploy           Apply pending migrations (use this for staging/main)
  status           Show which migrations have been applied
  reset            Drop the schema and re-apply every migration (DESTRUCTIVE)
  drift            Fail if the schema and the migrations disagree
  format           Format schema.prisma

Data
  seed             Insert demo users/products (refuses a production database)
  studio           Open Prisma Studio

Local database
  testdb           Create a throwaway database, migrate it, and print its URL
  up / down        Start / stop the project's Postgres via docker compose
EOF
}

# Run prisma from lib/db with the repository env loaded.
prisma() {
  ( cd "$DB_DIR" && npx --no-install prisma "$@" )
}

# Prisma resolves the datasource block before it decides what the command
# actually needs, so even `validate` (purely static) fails with P1012 when
# DATABASE_URL is absent. Hand it a syntactically valid placeholder: it is
# never used to reach a database.
prisma_static() {
  ( cd "$DB_DIR" && DATABASE_URL="${DATABASE_URL:-postgresql://x:x@localhost:5432/x}" \
      npx --no-install prisma "$@" )
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
  log "Validating schema.prisma"
  prisma_static validate
}

cmd_format() {
  require_installed
  log "Formatting schema.prisma"
  prisma_static format
}

cmd_migrate() {
  require_installed
  require_db_url
  warn "migrate dev may RESET the database if it decides the schema drifted."
  warn "Use '$0 deploy' for staging or main."
  log "Creating and applying a migration (local)"
  prisma migrate dev
}

cmd_deploy() {
  require_installed
  require_db_url
  log "Applying pending migrations"
  prisma migrate deploy
  # The CHECK constraints live outside the migrations because they need the
  # tables to exist first; checks.sql is written to be idempotent.
  if command -v psql >/dev/null 2>&1; then
    log "Applying data-integrity constraints"
    psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$DB_DIR/docker/checks.sql" \
      || warn "checks.sql did not apply (psql missing, or the DSN is not understood)"
  else
    note "psql not installed; skipping checks.sql"
  fi
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
  # CI runs exactly this: a migration that does not reproduce the schema is a
  # latent P2022 ("column does not exist") the first time it runs.
  local shadow="${SHADOW_DATABASE_URL:-}"
  [ -n "$shadow" ] || die "set SHADOW_DATABASE_URL to an empty database for the diff"
  log "Checking for drift between the migrations and schema.prisma"
  if prisma migrate diff \
        --from-migrations prisma/migrations \
        --to-schema-datamodel prisma/schema.prisma \
        --shadow-database-url "$shadow" \
        --exit-code; then
    ok "no drift"
  else
    die "drift detected: the migrations do not produce schema.prisma"
  fi
}

cmd_seed() {
  require_installed
  require_db_url
  log "Seeding demo data"
  ( cd "$DB_DIR" && node prisma/seed.js )
  ok "seeded"
}

cmd_studio() {
  require_installed
  require_db_url
  log "Opening Prisma Studio"
  prisma studio
}

cmd_testdb() {
  require_cmd docker psql
  require_installed
  local name="${1:-kosply_scratch}"
  local url="postgresql://kosply:kosply@localhost:55450/${name}?schema=public"
  log "Creating scratch database '$name' and migrating it"
  if ! docker ps >/dev/null 2>&1; then
    die "docker is not running"
  fi
  docker exec kosply-fix psql -U kosply -d postgres -c "DROP DATABASE IF EXISTS \"$name\"" >/dev/null 2>&1 || true
  docker exec kosply-fix psql -U kosply -d postgres -c "CREATE DATABASE \"$name\"" >/dev/null
  DATABASE_URL="$url" prisma migrate deploy
  ok "scratch database ready"
  echo
  echo "  DATABASE_URL=\"$url\""
  echo
}

cmd_up() {
  require_cmd docker
  log "Starting Postgres via docker compose"
  docker compose up -d postgres
  wait_for_port localhost 5432 Postgres 60 || true
}

cmd_down() {
  require_cmd docker
  log "Stopping docker compose services"
  docker compose down
}

main() {
  load_env
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