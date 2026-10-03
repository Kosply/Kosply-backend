# scripts/

Workflow helpers for the three deployables. Each script has a `--help`.

```
scripts/
  _common.sh        shared helpers (colours, .env loading, readiness probes)
  dev.sh            local stack: Postgres + server + agent, one ctrl-c
  server.sh         the server: `dev` for foreground, staging/main via PM2
  db/db.sh          Prisma + Postgres workflows
  agent/agent.sh    venv, run and test the Python agent
```

## First run

```bash
./scripts/dev.sh setup     # install everything, apply migrations
./scripts/dev.sh start     # boot the stack
./scripts/dev.sh logs      # tail both logs
./scripts/dev.sh stop
```

`setup` is the only command most people need. `start` alone will refuse with a
message telling you to run it.

## Configuration

Everything reads the repository `.env`. Copy `.env.example` to `.env` first and
fill in `DATABASE_URL`, `JWT_SECRET` and `INTERNAL_API_KEY`.

- `PORT` — server port, default `3000`
- `AGENT_PORT` — agent port, default `8000`
- `RATE_LIMIT=off` — disables request throttling (used by the test suite)

The scripts export `.env` into child processes rather than relying on each
service's own loader, because both dotenv (server) and the agent's loader read
`.env` relative to the *current directory* — a script that `cd`s elsewhere would
otherwise start the service with an empty configuration and no obvious error.

## Why the startup order is fixed

`dev.sh` starts Postgres, then the server, then the agent, and each step waits
for readiness instead of sleeping a fixed amount:

1. **Postgres first.** Everything else queries it on boot.
2. **Migrations before the server.** New code against an old schema fails as
   `column does not exist` (P2022) on live traffic.
3. **The agent last.** Its tools call the server's `/api/internal/*` API, which
   answers 401 without `INTERNAL_API_KEY`. Booting it earlier would look fine
   and still be useless.

## Per-component

### `scripts/db/db.sh`

```bash
./scripts/db/db.sh install     # npm ci + prisma generate
./scripts/db/db.sh validate    # static check; no database needed
./scripts/db/db.sh migrate     # create a migration (LOCAL only)
./scripts/db/db.sh deploy      # apply pending migrations (staging/main)
./scripts/db/db.sh drift       # fail if migrations != schema.prisma
./scripts/db/db.sh seed        # demo data; refuses a production database
./scripts/db/db.sh studio      # Prisma Studio
./scripts/db/db.sh reset       # DESTRUCTIVE; asks you to type the db name
./scripts/db/db.sh testdb      # throwaway migrated database, prints its URL
```

Use `deploy`, never `migrate`, against staging or main: `migrate dev` can decide
the schema drifted and **reset the database**.

`drift` is the check CI runs. It needs `SHADOW_DATABASE_URL` pointing at an
empty database.

### `scripts/agent/agent.sh`

```bash
./scripts/agent/agent.sh install   # venv + runtime + dev requirements
./scripts/agent/agent.sh dev       # uvicorn --reload on :8000
./scripts/agent/agent.sh test      # pytest
./scripts/agent/agent.sh shell     # shell inside the venv
./scripts/agent/agent.sh clean     # drop __pycache__ / .pytest_cache
```

`dev` refuses to start without `INTERNAL_API_KEY`, because an agent without it
answers 401 to all six of its own tools — a failure that looks like a broken
server rather than a missing variable.

### `scripts/server.sh`

```bash
./scripts/server.sh dev             # foreground with --watch, no PM2
./scripts/server.sh staging         # PM2, :3001
./scripts/server.sh main restart    # PM2, :3000
./scripts/server.sh status
```

`staging` and `main` apply pending migrations first, and `main` resolves its own
`DATABASE_URL` rather than inheriting whatever is in the environment. They need
PM2; `dev` needs neither PM2 nor the Go toolchain.

## Adding a command

Source the shared helpers rather than re-implementing them:

```bash
source "$(dirname "${BASH_SOURCE[0]}")/../_common.sh"
```

`require_cmd` before creating anything, `load_env` before reading configuration,
`wait_for_http` instead of `sleep`, and `die` instead of `exit 1` so failures
look the same everywhere.