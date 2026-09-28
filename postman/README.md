# Kosply Postman catalog

Import into Postman Desktop (or VS Code extension):
- `Kosply-API.postman_collection.json` — full API, folders per domain.
- `Kosply-API.postman_environment.json` — Local (`baseUrl` http://localhost:3000).
- `collections/` — same requests as `.request.yaml` per endpoint.

## Run order

1. Boot: Postgres up + seeded (`npm run seed` in `lib/db`), `npm start`.
2. `Auth/POST Register` (or Login) — `token` + `userId` captured automatically.
3. The rest follows; created ids (product, conversation, ticket, report, model) are captured as you go.
4. Admin/Seller paths need ADMIN/SELLER tokens — log in with such an account and paste the token into the `token` variable.
5. AI folder needs the agent up (`docker compose up agent`); else it answers 503 by design.

## Mocks (`mocks/`)

Every one of the 41 requests carries a saved example response, so a Postman
Mock Server can serve the whole catalog with no backend running — Flutter
can develop against it on day one. Create the mock from this collection in
Postman (Mock Servers → Create), then point `baseUrl` at the mock URL.
