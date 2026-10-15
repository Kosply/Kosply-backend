#!/bin/bash
# Entrypoint for Kosply's database bootstrap (MariaDB).
#
# The mariadb image executes `/docker-entrypoint-initdb.d/*` on first start of
# an empty volume. It runs `.sql` files through `mariadb` and `.sh` files as
# shell scripts. This wrapper is a shell script so it can interpolate env vars
# into the SQL (the mariadb client has no psql-style `:'var'` binding):
#
#   MARIADB_USER / MARIADB_PASSWORD  the application role. The image itself
#                   creates this role and its home database (MARIADB_DATABASE),
#                   but PM2 staging/main point at kosply_staging / kosply_main,
#                   so this script grants the role access to those too.
#   AGENT_DB_PASSWORD  the password for the least-privilege `kosply_agent`
#                   role. compose substitutes it into the agent's
#                   DATABASE_URL; without this the role was created with a
#                   hardcoded literal that silently disagreed with it.
#
# Init only runs on an empty data volume. Changing AGENT_DB_PASSWORD later
# needs a manual `ALTER USER 'kosply_agent'@'%' IDENTIFIED BY ...`, so rotate
# it deliberately.
set -euo pipefail

: "${MARIADB_USER:=kosply}"
: "${AGENT_DB_PASSWORD:=kosply}"

# The heredoc below is UNQUOTED so ${...} interpolates, which also means the
# shell performs command substitution inside it: a stray backtick in a comment
# turns into a command to run. Keep the SQL body free of backticks.
# A literal single quote in a password ends the string, so double it first.
agent_pw_escaped="${AGENT_DB_PASSWORD//\'/\'\'}"

# Everything below runs over the init-phase socket as root; no TCP needed.
# root already has its password at this point in the entrypoint (the temporary
# server is started without --skip-grant-tables and docker_setup_db has run), so
# an unauthenticated -uroot is rejected: pass the password the same way the
# entrypoint's own helpers do.
MYSQL_PWD="${MARIADB_ROOT_PASSWORD}" mariadb -uroot <<SQL
-- Databases the schema lives in. kosply_dev is created by the image via
-- MARIADB_DATABASE; the others are created defensively so this file cannot
-- abort on a volume that was initialised differently.
CREATE DATABASE IF NOT EXISTS kosply_dev;
CREATE DATABASE IF NOT EXISTS kosply_staging;
CREATE DATABASE IF NOT EXISTS kosply_main;
CREATE DATABASE IF NOT EXISTS kosply_agent;
-- Scratch database for the drift gate (scripts/db/schema-diff.sh, and CI).
-- It exists because the application role deliberately has no global CREATE
-- privilege: granting it would be a licence to drop kosply_main too. A dedicated
-- database, granted to the role, keeps `db.sh drift` working without that.
CREATE DATABASE IF NOT EXISTS kosply_shadow;

-- Application role: staging and main are separate databases under PM2, and
-- the image only granted the role its home database.
GRANT ALL PRIVILEGES ON kosply_dev.* TO '${MARIADB_USER}'@'%';
GRANT ALL PRIVILEGES ON kosply_staging.* TO '${MARIADB_USER}'@'%';
GRANT ALL PRIVILEGES ON kosply_main.* TO '${MARIADB_USER}'@'%';
GRANT ALL PRIVILEGES ON kosply_shadow.* TO '${MARIADB_USER}'@'%';

-- Least-privilege role for the AI agent -------------------------------------
-- The agent ingests buyer-controlled text into an LLM, so it is the
-- highest-risk process in the stack. It previously held the cluster superuser
-- credential, which could read and write kosply_main. It only needs the
-- checkpoint tables and the ai_* history mirror, in its own database.
-- MariaDB grants are per-database and per-host; '%' covers both the compose
-- network and a host-run agent.
CREATE USER IF NOT EXISTS 'kosply_agent'@'%' IDENTIFIED BY '${agent_pw_escaped}';
-- Re-apply on every init so the compose-substituted password always matches
-- the DATABASE_URL the agent is started with.
ALTER USER 'kosply_agent'@'%' IDENTIFIED BY '${agent_pw_escaped}';
GRANT ALL PRIVILEGES ON kosply_agent.* TO 'kosply_agent'@'%';
FLUSH PRIVILEGES;
SQL
