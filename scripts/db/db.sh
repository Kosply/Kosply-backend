#!/usr/bin/env bash
#
# @title Kosply database workflows (lib/db)
# @notice Install, migrate, seed and inspect the MariaDB schema.
# @dev `migrate deploy` (not `migrate dev`) is what any shared environment uses:
# @dev `migrate dev` can reset a database when it decides the schema drifted,
# @dev which on staging or main is data loss. `dev` here is reserved for a local
# @dev scratch database and says so.
# @dev Migrations are plain SQL applied by `lib/db/src/migrate.js`. There is no
# @dev shadow database and no datamodel to diff against: `schema/migrations/*.sql`
# @dev is the schema, and `lib/db/src/schema.js` describes the columns the app
# @dev reads and writes. `schema-diff.sh` checks the two agree.
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
  install          npm ci in lib/db
  generate         No-op: the data layer is plain JS, nothing is generated

Schema
  validate         Check the column registry (tables, columns, relations)
  migrate <name>   Create an empty migration file for you to fill in (LOCAL ONLY)
  deploy           Apply pending migrations (use this for staging/main)
  status           Show which migrations have been applied
  reset            Drop the schema and re-apply every migration (DESTRUCTIVE)
  drift            Fail if the column registry and the migrations disagree

Data
  seed             Insert demo users/products (refuses a production database)
  studio           Not available: use a MariaDB client instead

Local database
  testdb           Create a throwaway database, migrate it, and print its URL
  up / down        Start / stop the project's MariaDB via docker compose
EOF
}

MIGRATIONS_DIR="$DB_DIR/schema/migrations"

schema_diff() {
  "$ROOT/scripts/db/schema-diff.sh" "$@"
}

# Every database command goes through the library's own runner, with the repo
# env already loaded by `load_env` in main().
db_migrate() {
  ( cd "$DB_DIR" && node src/cli.js deploy )
}

db_status() {
  ( cd "$DB_DIR" && node src/cli.js status )
}

db_reset() {
  ( cd "$DB_DIR" && node src/cli.js reset )
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
  ok "lib/db ready"
}

cmd_generate() {
  # There is no code generation: the data layer is plain JavaScript and the
  # column registry is hand-written. Kept as a command so muscle memory, and any
  # CI step that calls it, keep working.
  require_installed
  ( cd "$DB_DIR" && node src/cli.js validate )
  ok "nothing to generate"
}

cmd_validate() {
  require_installed
  log "Checking the column registry"
  ( cd "$DB_DIR" && node src/cli.js validate ) || die "column registry is inconsistent"
}

cmd_format() {
  die "format: schema.db no longer exists. The SQL files are the schema; format them in your editor."
}

cmd_migrate() {
  require_installed
  require_db_url
  local name="${1:-}"
  [ -n "$name" ] || die "usage: $0 migrate <name>   (e.g. $0 migrate add_promo_codes)"
  warn "This applies migrations to the database in DATABASE_URL."
  warn "Use '$0 deploy' for staging or main."
  # A migration here is a hand-written SQL file applied by our own runner. The
  # old flow generated it by diffing a datamodel against a shadow database;
  # with no datamodel there is nothing to diff, and writing the DDL directly is
  # the honest workflow.
  local dir
  dir="$MIGRATIONS_DIR/$(date -u +%Y%m%d%H%M%S)_$name"
  mkdir -p "$dir"
  : > "$dir/migration.sql"
  ok "created $(basename "$dir")/migration.sql — write the DDL, then: $0 deploy"
  echo
  echo "  $EDITOR $dir/migration.sql"
  echo "  ./scripts/db/db.sh deploy"
  echo
}

cmd_deploy() {
  require_installed
  require_db_url
  log "Applying pending migrations"
  # The runner also re-applies docker/checks.sql, which has to come after the
  # DDL: the CHECK constraints reference columns that must exist first, and the
  # file is idempotent so re-running it on every deploy is intended.
  db_migrate
  ok "database is up to date"
}

cmd_status() {
  require_installed
  require_db_url
  db_status
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
  db_reset
  ok "schema reset"
}

cmd_drift() {
  require_installed
  require_db_url
  # CI runs exactly this (scripts/db/schema-diff.sh check). A column the app
  # reads but no migration creates is a latent "column does not exist" the first
  # time that code path runs in production.
  log "Checking the column registry against the migrations"
  if schema_diff check; then
    ok "no drift"
  else
    die "drift detected: the migrations and the column registry disagree"
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
  # Prisma Studio went with the ORM. There is no drop-in replacement: use a
  # MariaDB client, or the admin dashboard routes this project already ships.
  die "studio: Prisma Studio is gone. Use a MariaDB client, e.g. mariadb -h 127.0.0.1 -u kosply -p"
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
  DATABASE_URL="$url" db_migrate
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