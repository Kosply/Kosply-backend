# Kosply Server

Express API powering Kosply. Lives in `lib/server/` so `lib/` can later
hold sibling runtimes (`lib/agent/` for Python, `lib/shared/`, etc.)
without refactoring the project root.

## Stack

- Node >=18, Express 4 (stable)
- helmet, cors, compression, morgan, dotenv
- PM2 process manager (see root `ecosystem.config.js`)

## Structure

```
lib/server/
  server.js             # entrypoint: bind port + graceful shutdown
  app.js                # Express setup (global middleware, route mount)
  config/env.js         # env loader (PORT, NODE_ENV, CORS_ORIGIN)
  routes/               # index.js aggregator + *.route.js per module
  controllers/          # per-module logic (req/res)
  middlewares/          # notFound (404), errorHandler (central), asyncHandler
```

`server.js` binds the port; `app.js` only builds the app (no binding),
so the app stays importable for tests and PM2 cluster mode stays
predictable. Error flow: route → `asyncHandler` → controller → `next(err)` →
`errorHandler`; unknown paths fall into `notFound` first.

## Code documentation

All files use NatSpec-style docblocks (`@title`, `@notice`, `@dev`,
`@param`, `@return`) so behavior and contracts sit right above the code.

## Env

| Key | Local | Staging (PM2) | Main (PM2) |
|---|---|---|---|
| `NODE_ENV` | `development` | `staging` | `production` |
| `PORT` | `3000` | `3001` | `3000` |
| `CORS_ORIGIN` | `*` | `*` | `*` (set the real domain on go-live) |

Resolution order: PM2 `env` → `.env` file → defaults in `config/env.js`
(dotenv never overrides existing variables, so PM2 always wins).
`PORT` is strictly validated (digits only, 1-65535); `CORS_ORIGIN` lists are
trimmed; `app.js` sets `trust proxy: 1` with `1mb` body limits.

## Run

```bash
# From the project root:
npm run dev             # watch mode on :3000 (.env)
npm run dev:staging     # staging simulation on :3001
npm start               # single instance on :3000

# PM2 (recommended) — staging first, main after it passes:
./scripts/server.sh staging
./scripts/server.sh main
```

## Endpoints

- `GET /` → `{ name, status, env }` (root health for PM2 / load balancer)
- `GET /api/health` → `{ status, service, uptime, timestamp }`

## Adding a new module

1. Create `routes/<name>.route.js` (paths + method wiring only, wrap handlers with `asyncHandler`).
2. Create `controllers/<name>.controller.js` (req/res handling only).
3. Register it in `routes/index.js`:
   `router.use('/<name>', require('./<name>.route'))`.
4. Keep controllers thin — extract a `services/` layer once business
   logic grows; document new files with NatSpec blocks.
5. Mirror new routes in `lib/server-monitoring/internal/api/api.go`
   `Registry()` so `kosmon list` and menu testing stay complete.
