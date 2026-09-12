# Kosply-backend

Kosply backend — Express + PM2. Server focus for now.

## Stack
- Node >=18, Express 4 (stable)
- helmet, cors, compression, morgan, dotenv
- PM2 process manager via `ecosystem.config.js`

## Structure
```
Kosply-backend/
  ecosystem.config.js       # PM2: 2 apps (staging + live)
  package.json              # root scripts -> lib/server
  .env.example
  scripts/
    server.sh             # single launcher: ./scripts/server.sh <staging|live> [start|stop|restart|status]
  lib/
    server/                 # all server code lives here
      server.js             # entrypoint + graceful shutdown
      app.js                # Express setup (global middleware)
      config/env.js         # env loader (PORT, NODE_ENV, CORS_ORIGIN)
      routes/               # index.js aggregator + *.route.js per module
      controllers/          # per-module logic (req/res)
      middlewares/          # notFound, errorHandler
```

Why `lib/server/` instead of `src/`? So `lib/` can later hold sibling runtimes
(`lib/agent/` for Python, `lib/shared/`, etc.) without refactoring the root.
Only `server` exists for now.

## Code documentation
All source files use NatSpec-style docblocks (`@title`, `@notice`, `@dev`,
`@param`, `@return`) so behavior, side effects, and contracts are visible
right above each module and function during development.

## Getting started
```bash
cp .env.example .env
npm install

# Local (no PM2)
npm run dev             # dev on :3000 (.env)
npm run dev:staging     # staging simulation on :3001
npm start               # single instance on :3000
npm run start:staging   # single instance on :3001

# PM2 via single helper script (recommended, delegates to kosmon when built)
./scripts/server.sh staging
# test http://localhost:3001/api/health
./scripts/server.sh live

pm2 status
```

## Scripts
- `dev` / `start` — local dev on `:3000` (uses `.env`)
- `dev:staging` / `start:staging` — staging simulation on `:3001`
- `start:live` — live simulation, single instance on `:3000`
- `scripts/server.sh <staging|live> [start|stop|restart|status]` — single PM2 launcher (uses `kosmon` when built)
- `pm2:start` — run staging + live together
- `pm2:start:staging` / `pm2:start:live` — run one of them
- `pm2:stop / pm2:restart / pm2:logs` (plus `:staging` / `:live`) — manage per env

## Env
| Key | Local | Staging (PM2) | Live (PM2) |
|---|---|---|---|
| `NODE_ENV` | `development` | `staging` | `production` |
| `PORT` | `3000` | `3001` | `3000` |
| `CORS_ORIGIN` | `*` | `*` | `*` (set the real domain on go-live) |

## Health check
- `GET /` → `{ name: kosply-backend, status: ok, env }`
- `GET /api/health` → `{ status: ok, service, uptime, timestamp }`

## Adding a new module
1. Create `lib/server/routes/<name>.route.js`
2. Create `lib/server/controllers/<name>.controller.js`
3. Register it in `lib/server/routes/index.js`: `router.use('/<name>', require('./<name>.route'))`
4. Keep controllers thin — extract a `services/` layer once business logic grows.

## PM2 notes
- `kosply-server-staging` — `fork`, 1 instance, `:3001`. Playground: test freely, restart anytime.
- `kosply-server-live` — `cluster` (`instances: max`), `:3000`. Serves real users, never test here directly.
- `server.js` handles `SIGTERM`/`SIGINT` + `unhandledRejection`, safe for `pm2 restart/reload`.
- Safe flow: change code → `./scripts/server.sh staging restart` → test `:3001` → pass → `./scripts/server.sh live restart`.

## Server monitoring CLI (Go)

`lib/server-monitoring/` (`kosmon`) tests APIs and controls staging/live.
Stdlib only. Two versions:

```bash
cd lib/server-monitoring
go build -o kosmon .

./kosmon                                # interactive: ASCII banner + version + menu
./kosmon list                           # list all APIs
./kosmon test /api/health --env staging # call an endpoint
./kosmon start|stop|restart <staging|live>
./kosmon switch live                    # run live, stop staging
```

Set `KOSPLY_ROOT` if auto-detection of the project root fails.
See `lib/server-monitoring/README.md` for details.

## Next
- DB (Prisma/Drizzle/Mongoose)
- Auth (JWT)
- Validation (zod)
- Logger (pino)
- `lib/agent/` (Python) + `lib/shared/` (contracts) — later, once the server is stable
