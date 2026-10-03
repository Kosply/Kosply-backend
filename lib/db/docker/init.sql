-- Kosply database bootstrap.
--
-- Runs on the FIRST start of an empty pgdata volume, executed by the official
-- postgres image with `psql -v ON_ERROR_STOP=1` — so a single error aborts the
-- whole file and the container exits. Every statement must therefore be valid
-- on its own, and failures that are acceptable must be handled explicitly.
--
-- Migrations are NOT applied here: `scripts/server.sh` runs
-- `prisma migrate deploy` on every start/restart, which is idempotent and
-- covers pre-existing volumes. The tables referenced by the CHECK constraints
-- below only exist after those migrations, so the constraints are added
-- separately by `lib/db/docker/checks.sql` (idempotent, safe to re-run).

-- Databases -----------------------------------------------------------------
-- NULLs aside, this must create `kosply_agent` too: the compose agent is given
-- that role, and omitting it made `GRANT CONNECT` fail, which aborted the whole
-- init and left Postgres down.
-- The primary database is POSTGRES_DB in compose, but create it defensively
-- so this file cannot abort on a cluster that was initialised differently:
-- a failure here kills the container, because psql runs with ON_ERROR_STOP=1.
SELECT 'CREATE DATABASE kosply_dev'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kosply_dev')\gexec
SELECT 'CREATE DATABASE kosply_staging'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kosply_staging')\gexec
SELECT 'CREATE DATABASE kosply_main'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kosply_main')\gexec
SELECT 'CREATE DATABASE kosply_agent'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'kosply_agent')\gexec

-- Extensions the schema relies on ------------------------------------------
-- `pg_trgm` is required for the trigram index that keeps catalog search
-- (`ILIKE '%q%'`) from degrading into a full sequential scan. Available in the
-- stock image, but created per database so every app database gets it.
\connect kosply_dev
CREATE EXTENSION IF NOT EXISTS pg_trgm;
\connect kosply_staging
CREATE EXTENSION IF NOT EXISTS pg_trgm;
\connect kosply_main
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Least-privilege role for the AI agent -------------------------------------
-- The agent ingests buyer-controlled text into an LLM, so it is the
-- highest-risk process in the stack. It previously held the cluster superuser
-- credential, which bypasses per-database CONNECT and could therefore read and
-- write `kosply_main`. It only needs the checkpoint tables and the `ai_*`
-- history mirror, in its own database.
-- The password comes from `AGENT_DB_PASSWORD` (compose substitutes it into the
-- agent's DATABASE_URL). Hardcoding 'kosply' here meant that an operator who
-- followed .env.example and set AGENT_DB_PASSWORD got a role whose password did
-- not match: `create_saver()` then raised out of the FastAPI lifespan and the
-- container crash-looped on `restart: unless-stopped` with a confusing
-- checkpointer error instead of an authentication one.
--
-- Default only applies when the variable is absent, so a plain `psql -f` on a
-- developer machine still works.
-- psql does NOT interpolate :'var' inside a dollar-quoted $$...$$ block (the
-- server then sees the literal `:'agent_password'` and reports a syntax
-- error), so this uses \gexec, which is expanded by psql before it is sent.
SELECT format('CREATE ROLE kosply_agent LOGIN PASSWORD %L', :'agent_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kosply_agent')\gexec

-- Re-apply on every start so rotating the secret actually takes effect.
SELECT format('ALTER ROLE kosply_agent PASSWORD %L', :'agent_password')\gexec

\connect kosply_agent
GRANT CONNECT ON DATABASE kosply_agent TO kosply_agent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
