# lib/

Monorepo runtimes. Each folder is one self-contained runtime with its own
toolchain, dependencies and README. They never import each other's code
directly — they communicate over HTTP.

## Members

| Folder | Runtime | Purpose |
|---|---|---|
| `server/` | Node (Express) | The public HTTP API: staging `:3001`, main `:3000` |
| `agent/` | Python (FastAPI + LangGraph) | Internal AI service: chat, streaming, human approval |
| `db/` | Node (Prisma) + Postgres 16 | Schema, migrations, shared read shapes (a library, not a process) |
| `server-monitoring/` | Go (`kosmon` CLI) | Test endpoints, drive staging/main through PM2 |

There is also `postman/` at the repository root: the API catalog, checked
against the routes by `scripts/postman/validate.sh`.

Details live in each folder's README:

- `server/README.md` — structure, env, endpoints, which table backs what
- `agent/README.md` — endpoints, the prompt, approval and resume, known gaps
- `db/README.md` — schema, migrations, the integrity constraints
- `server-monitoring/README.md` — build, interactive and non-interactive use

## Rules for adding a new lib

1. **One folder per runtime.** `server/` Node, `agent/` Python,
   `server-monitoring/` Go. Exception: `db/` is a shared library (Prisma schema
   + client) rather than a running process.
2. **Own manifest only.** `package.json` for Node, `requirements.txt` for
   Python, `go.mod` for Go. Never mix them in one folder.
3. **No direct cross-runtime imports.** Communicate over HTTP. The one
   documented exception: `server/` and `agent/` both read `DATABASE_URL` from
   the environment, and `server/` may import `../db/src/client`.
   The agent reaches the marketplace data only through the server's
   `/api/internal/*` API — it never queries those tables, which is what lets the
   runtimes stay separate.
4. **Every lib ships its own `README.md`** covering stack, structure, run and
   env.
5. **Mirror cross-cutting changes.** New server routes go into the `kosmon`
   `Registry()` (`server-monitoring/internal/api/api.go`) and into the Postman
   catalog. CI checks the catalog against the routes, so a route without an entry
   fails the build.
6. **Secrets are environment variables, never committed.** `.env*` is ignored
   except `.env.example`, which holds empty placeholders only. The agent's
   least-privilege database role is created by `db/docker/init.sql` from
   `AGENT_DB_PASSWORD`, so it must match that variable.

## The three trust tiers

Worth knowing before adding anything, because it decides which middleware a
route needs:

| Tier | Caller | Guard |
|---|---|---|
| Public | Flutter app | `authenticate`, or `optionalAuthenticate` for owner-or-anonymous reads |
| Staff | dashboard | `requireRole('ADMIN', 'SUPER_ADMIN')` |
| Machine | the agent | `requireInternalKey` (`x-internal-key`) on `/api/internal/*` |

The agent additionally gates its own write tools behind human approval, so it
cannot contact a seller or send a chat message on a user's behalf without
consent. See `agent/agent_spec/tables/human_in_the_loop.md`.