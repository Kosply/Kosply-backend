# lib/

Monorepo runtimes. Each folder is one self-contained runtime with its
own toolchain, dependencies, and README — they never import each
other's code directly.

## Members

| Folder | Runtime | Purpose |
|---|---|---|
| `server/` | Node (Express) | HTTP API: staging `:3001`, main `:3000` |
| `server-monitoring/` | Go (`kosmon` CLI) | Test endpoints, control staging/main via PM2 |
| `db/` | Node (Prisma) + Postgres 16 | Schema + client: User, SellerVerification, Product |

Details live in each folder's README:

- `server/README.md` — API structure, env, run, adding modules
- `server-monitoring/README.md` — build, interactive + non-interactive use

## Rules for adding a new lib

1. One folder per runtime (e.g. `agent/` for Python later). Exception: `db/` is a shared library (Prisma schema + client), not a running process.
2. Own manifest only: `package.json` for Node, `requirements.txt` /
   `pyproject.toml` for Python, `go.mod` for Go. Never mix.
3. No direct imports across runtimes — communicate over HTTP on
   localhost (or a queue), with the contract documented in
   `lib/shared/` once it exists. Exception: `server/` may import
   `../db/src/client` (read `DATABASE_URL` from env, never hardcode).
4. Every lib ships its own `README.md` (stack, structure, run, env).
5. Mirror cross-cutting changes: new server routes go into the
   `kosmon` `Registry()`; new envs go into `internal/config/`.
