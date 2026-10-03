# personas — implemented

File: `app/agent/policy/personas/` (`personas.py`). The agent reads the caller role and
switches personality: seller mode vs buyer mode.

The persona text is English because it is read by the model, not shown to the user.
It does **not** fix the answer language: the base prompt tells the model to reply in
whatever language the user wrote in.

| Role | Persona | Helps with |
|---|---|---|
| `SELLER` | `[MODE: SELLER]` | listing copy, second-hand pricing, stock, buyer replies, KTM verification, seller-side COD safety |
| `BUYER` | `[MODE: BUYER]` | product search, price comparison, condition checks, polite negotiation, COD safety, fraud reporting |
| anything else | `[MODE: GENERAL]` | neutral Kosply help for both sides |

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
