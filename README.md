# Kosply-backend

Kosply — marketplace barang second-hand untuk mahasiswa. Backend monorepo: satu
Express API, satu AI agent (Python/FastAPI), satu skema database (MariaDB), plus
CLI monitoring (Go).

## Stack

| Bagian | Teknologi |
|---|---|
| `lib/server` | Node >=18, Express 4 |
| `lib/agent` | Python >=3.10, FastAPI, LangGraph, uvicorn |
| `lib/db` | MariaDB 11.4 + mysql2 (tanpa ORM) |
| `lib/server-monitoring` | Go, stdlib only (`kosmon`) |
| Proses | PM2 (`ecosystem.config.js`) |

Server: `helmet`, `cors`, `compression`, `morgan`, `dotenv`, `jsonwebtoken`,
`bcryptjs`, `google-auth-library`, `jwks-rsa`.

## Structure

```
Kosply-backend/
  ecosystem.config.js       # PM2: kosply-server-staging + kosply-server-main
  docker-compose.yml        # MariaDB + agent (+ one-shot agent migration)
  package.json
  .env.example
  seed.sh                   # dashboard demo seed — fills a dev db (seed/README.md)
  seed/                     # fixtures for every dashboard surface
    accounts.js             #   login-able operator account (placeholders, env-driven)
    dashboard.js            #   users, products, verifications, reports, tickets, models
    guard.js                #   refuses production / non-dev databases
    index.js                #   runner: ./seed.sh [all|accounts|dashboard]
  scripts/                  # workflow helpers, see scripts/README.md
    dev.sh                  # local stack: MariaDB + server + agent, one ctrl-c
    server.sh               # server: `dev` foreground, staging/main via PM2
    db/db.sh                # migrasi + drift gate MariaDB
    agent/agent.sh          # venv, run and test the Python agent
    postman/validate.sh     # catalog-vs-routes drift check (runs in CI)
    _common.sh              # shared helpers (env loading, readiness probes)
  lib/
    server/                 # Express API — the whole public surface
      server.js             # entrypoint + graceful shutdown
      app.js                # global middleware (helmet, cors, body, routes)
      config/               # env + gateway ke lib/db
      routes/               # index.js aggregator + *.route.js per module
      controllers/          # thin HTTP layer (req/res)
      services/             # business logic + shared/validators.js
      middlewares/          # auth, errorHandler, notFound, asyncHandler,
                           #   internalKey, rateLimit
      tests/                # node:test, grouped per module
    agent/                  # AI agent — internal, never public
      app/main.py           # FastAPI app + middleware order
      app/api/              # /ai/chat, /stream, /resume, /wait, /history
      app/agent/            # LangGraph: tools, policy, memory, personas
      app/core/             # config, errors, limits, http (outbound auth)
      agent_spec/tables/    # per-subsystem design notes
      tests/
    db/                     # schema + migrations are the source of truth
      schema/migrations/
      schema/seed.js
      docker/init.sh|.sql   # cluster bootstrap
      docker/checks.sql     # data-integrity constraints (post-migrate)
      src/selects.js        # shared read shapes
    server-monitoring/      # kosmon CLI
  postman/                  # collection + specs
```

`lib/` holds sibling runtimes rather than `src/` so each language keeps its own
tooling. The agent reaches the server only over HTTP (`/api/internal/*`), never
the database — that rule is what makes the split possible.

## Getting started

A complete first run, from an empty machine to a seeded database.

### 0. Prerequisites

- **Docker Desktop** — <https://www.docker.com/products/docker-desktop/> — runs
  MariaDB (`mariadb:11.4`) and the agent container. Any Docker Engine with
  Compose v2 works; make sure `docker compose` is on your `PATH`.
- **Node.js >= 18** — the Express server and the seed scripts.
- Python is not required for the Docker path (the agent is built as an image);
  `./scripts/dev.sh setup` additionally creates `lib/agent/.venv` for a native
  agent run.
- Local ports used: `3306` (MariaDB, loopback only), `3000` (server), `8000`
  (agent, loopback only).

### 1. Clone

```bash
git clone <repository-url> kosply-backend
cd kosply-backend
```

### 2. Configure

```bash
cp .env.example .env
```

Fill in at least `DATABASE_URL`, `JWT_SECRET`, `INTERNAL_API_KEY` and the
`MARIADB_*` bootstrap values. `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` /
`SEED_ADMIN_NAME` are optional and only used by the demo seed in step 5.

### 3. Start the database (Docker)

```bash
docker compose up -d mariadb
```

On the first start of an empty volume, `lib/db/docker/init.sh` creates
`kosply_dev`, `kosply_staging`, `kosply_main` and the least-privilege
`kosply_agent` database. This step comes **before** installing, because
applying migrations needs a reachable database.

### 4. Install dependencies and apply migrations

```bash
./scripts/dev.sh setup    # db deps + root deps + agent venv, then migrations
./scripts/dev.sh start    # server :3000 + agent :8000
```

Check the stack:

```bash
curl -s localhost:3000/api/health
./scripts/dev.sh logs     # tail the server + agent logs
./scripts/dev.sh stop     # stops server + agent; MariaDB keeps running
```

### 5. Seed the dashboard data

```bash
./seed.sh                 # operator account + every dashboard fixture
```

The admin dashboard (separate repo) reads this API through its `API_URL`, so
seed now and its pages come up populated instead of empty. `./seed.sh` takes
placeholders by default — set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in
`.env` to seed a real login. Modes: `./seed.sh accounts` (account only),
`./seed.sh dashboard` (fixtures only). Full fixture list: `seed/README.md`.

### Reset the database

```bash
./scripts/dev.sh reset    # drop schema, migrate, re-run the lib/db seed
./seed.sh                 # then re-add the dashboard demo data
```

`reset` is destructive and deliberately interactive: it prints the target
database and asks you to **type its name** (`kosply_dev`) before touching
anything. Two different seeds are involved and they do not overlap:
`lib/db/schema/seed.js` (run by `dev.sh reset`) creates minimal marketplace
fixtures with non-loginable marker hashes, while `./seed.sh` creates the
operator account and everything the dashboard renders.

To stop the database itself use `docker compose down` (the volume is kept); to
wipe that volume as well — a true from-zero run — `docker compose down -v` and
start again from step 3.

To run just the server in the foreground (no PM2, no Go toolchain):

```bash
./scripts/server.sh dev
```

See `scripts/README.md` for every command and for why the startup order is
MariaDB → migrations → server → agent.

## Seed dashboard demo data

Fill a dev database with everything the admin dashboard renders — the
login-able operator account, KTM verifications, fraud reports, support tickets
(with threads), AI models and tool-invocation benchmark rows — so no dashboard
page is empty. Commands live in step 5 of
[Getting started](#getting-started); the rules behind them:

The script ships with **placeholders** (`admin@example.com` / `ChangeMe-…`):
set your own values in `.env` (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`,
`SEED_ADMIN_NAME`) or pass them inline. `seed/guard.js` refuses
`NODE_ENV=production` and any database that is not `kosply_dev`, `kosply_test`
or `test`. Re-running is idempotent — rows upsert on stable keys. Full fixture
list and design rules: `seed/README.md`.

## Testing

```bash
npm test                      # server + db (needs DATABASE_URL)
./scripts/agent/agent.sh test # agent (pytest)
./scripts/db/db.sh drift      # migrations harus cocok dengan column registry
./scripts/postman/validate.sh # the Postman catalog still matches the routes
```

`npm test` sets `RATE_LIMIT=off`: the suite drives many auth attempts in one
process and would otherwise trip its own throttling.
`tests/shared/rate_limit.test.js` re-enables it and asserts the real behaviour.

CI additionally runs the agent suite, `db.sh deploy` against a real
MariaDB, the drift gate, and a check that the Postman catalog still matches the
routes. That last one exists because the catalog is maintained by hand in two
formats, and it had silently fallen behind — a new route with no catalog entry
now fails the build.

## Env

| Key | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | the data layer + the agent's checkpointer |
| `JWT_SECRET` | yes (production) | Production boot **fails** if unset or left at the published dev value |
| `INTERNAL_API_KEY` | yes | Guards `/api/internal/*` (the agent → server API) |
| `NODE_ENV` | no | `development` \| `staging` \| `production` |
| `PORT` | no | digits only, 1-65535, fallback `3000` |
| `TRUST_PROXY_HOPS` | no | `0` by default. Must be set behind a load balancer |
| `CORS_ORIGIN` | no | comma list; `*` unless you set a real origin |
| `AI_AGENT_URL` | no | default `http://localhost:8000` |
| `MARIADB_*`, `AGENT_DB_PASSWORD` | docker | cluster bootstrap; `AGENT_DB_PASSWORD` must match the agent's `DATABASE_URL` |

The agent has its own set (`AI_MODEL`, `AI_MODEL_TIMEOUT_S`, `OPENAI_API_KEY`,
`KOSPLY_SERVER_URL`, …) — see `lib/agent/.env.example`.

Per environment:

| | Local | Staging | Main |
|---|---|---|---|
| `NODE_ENV` | `development` | `staging` | `production` |
| `PORT` | `3000` | `3001` | `3000` |
| Database | `kosply_dev` | `kosply_staging` | `kosply_main` |

## Health

- `GET /` → `{ name, status, env }`
- `GET /api/health` → `{ status, service, uptime, timestamp }`, dependency-free
  so it stays green when something downstream is down
- On the agent (container-only, bound to loopback):
  - `GET /health` → `{ status, service }` — liveness
  - `GET /readyz` → 200 when the checkpointer answers, `degraded` on the
    in-memory saver. This is the probe that catches a broken database, which
    `/health` cannot: the agent boots fine and answers `/health` while every
    real request fails its ownership check.

## Architecture notes

**Identity comes from the JWT, always.** `authenticate` re-reads role and
`isActive` from the database on every request, so a ban takes effect immediately
rather than when the token expires. Dashboard operators live in `admins`, users
in `users`; the two id namespaces are disjoint and the token's `kind` says which
one to resolve.

**Three tiers of trust.** Public Flutter traffic → `authenticate`. Staff →
`requireRole`. The agent → `x-internal-key` on `/api/internal/*`.

**The agent cannot act on a user's behalf without approval.** `SENSITIVE_TOOLS`
(`send_chat_message`, `request_seller_contact`) pause the LangGraph through
`interrupt()`; the client resumes with `POST /ai/chat/resume`. Approval is
consent for an *action*, never for an *identity*: the acting user is read from
graph state, so an approved "send this message" cannot be redirected at someone
else. `lib/agent/agent_spec/tables/human_in_the_loop.md` has the full contract.

**Rate limiting** is per-surface: login 10/15min keyed on IP *and* normalised
email, password reset 5/15min, register 10/hour, public analytics ingest
120/min. Counters are in-process, so under PM2 the ceiling is roughly
`limit × instances` — a shared store is the production answer.

**No user input reaches the database unvalidated.** `services/shared/validators.js`
(`toId`, `toText`, `toNumber`, `toQueryInt`) is the boundary, including for ids
the *model* chose.

## Adding a new module

1. `lib/server/routes/<name>/<name>.route.js` — wrap handlers in `asyncHandler`
2. `lib/server/controllers/<name>/<name>.controller.js` — keep it thin
3. `lib/server/services/<name>/<name>.service.js` — business logic
4. Register in `lib/server/routes/index.js`
5. Mirror the route in `lib/server-monitoring/internal/api/api.go` `Registry()`
   so `kosmon list` stays complete
6. Tests in `lib/server/tests/<name>/`

Choose the middleware deliberately: `authenticate`, `requireRole`,
`optionalAuthenticate` (owner-or-anonymous reads), `requireInternalKey`, and
`rateLimit` when the route is expensive or guessable.

Every file carries a docblock (`@title`, `@notice`, `@dev`, `@param`,
`@return`). `@dev` is where the reasoning and the bug history live — please keep
writing *why*, not *what*.

## PM2

- `kosply-server-staging` — `fork`, 1 instance, `:3001`. Test freely here.
- `kosply-server-main` — `cluster`, up to 4 instances, `:3000`. Real users.
- Instance count and pool size are derived from `DB_CONNECTION_LIMIT` so the
  workers fit inside `DB_CONNECTION_LIMIT`.
- `server.js` handles `SIGTERM`/`SIGINT` plus `unhandledRejection` and
  `uncaughtException` with a graceful shutdown, safe for `pm2 restart`.
- Safe flow: change code → `./scripts/server.sh staging restart` → test `:3001`
  → pass → `./scripts/server.sh main restart`.

## Server monitoring CLI (Go)

`kosmon` tests APIs and drives PM2. Stdlib only.

```bash
cd lib/server-monitoring && go build -o kosmon .
./kosmon                                 # interactive
./kosmon list                            # all registered APIs
./kosmon test /api/health --env staging  # GET|HEAD|DELETE|OPTIONS
./kosmon start|stop|restart <staging|main>
./kosmon switch main
```

Set `KOSPLY_ROOT` if project-root detection fails.

## Known gaps

Honest list of what is *not* finished:

- `POST /api/internal/contact-requests` validates and returns `202`, but
  creates no chat room and sends no notification. `request_seller_contact` is
  approval-gated and currently does nothing on the other side.
- Password reset generates a 4-digit code; there is no mailer, so it is never
  delivered. Needs an SMTP provider.
- A pending approval interrupt has no TTL — an approval left open accumulates in
  the checkpointer until the thread is reused.
- Rate-limit counters are per-process (see Architecture notes).
- `CORS_ORIGIN` still defaults to `*`; set a real origin before go-live.

## Docs

| Where | What |
|---|---|
| `lib/server/README.md` | server detail, and which table backs what |
| `lib/agent/README.md` | agent detail |
| `lib/agent/agent_spec/tables/` | per-subsystem design notes |
| `lib/db/README.md` | schema and migration workflow |
| `seed/README.md` | dashboard demo fixtures, and how to run `./seed.sh` |
| `scripts/README.md` | every script, and the ordering rules |
| `postman/README.md` | the API catalog, run order, and the validator |