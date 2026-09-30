# personas — implemented

File: `app/agent/policy/personas/` (`personas.py`). The agent reads the caller role and
switches personality: seller mode vs buyer mode.

| Role | Persona | Helps with |
|---|---|---|
| `SELLER` | `[MODE: PENJUAL]` | listing copy, second-hand pricing, stock, buyer replies, KTM verification, seller-side COD safety |
| `BUYER` | `[MODE: PEMBELI]` | product search, price comparison, condition checks, polite negotiation, COD safety, fraud reporting |
| anything else | `[MODE: UMUM]` | neutral Kosply help for both sides |

## Wiring

| Step | Where |
|---|---|
| Flutter sends `role` (from login) | `POST /ai/chat` + `/ai/chat/stream` (`ChatRequest.role`, default `UNKNOWN`) |
| Role stored in state | `AgentState.user_role` (optional key, persists via checkpointer) |
| Prompt built per turn | `build_system_prompt(SYSTEM_PROMPT, role)` in the `agent` node |
| Model verifies role itself | `get_user_role` tool (plain, non-sensitive) via `GET /api/internal/users/:id` |

## Rules

| Rule | Notes |
|---|---|
| Persona never replaces scope | the Kosply scope prompt always stays first, persona is appended |
| Resume keeps persona | `user_role` lives in checkpointed state; resume needs no re-send |
