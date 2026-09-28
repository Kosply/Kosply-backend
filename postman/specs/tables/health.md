# health — implemented

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| GET | `/` | none | `200 {name, status, env}` | — |
| GET | `/api/health` | none | `200 {status, service, uptime, timestamp}` | — |
