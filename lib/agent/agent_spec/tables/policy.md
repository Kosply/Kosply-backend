# policy — implemented

File: `app/agent/policy/`. Hardening so the AI can't be misused: prompt
injection is rejected before any LLM call, and off-topic messages are
refused with a short Kosply explainer.

## Layers

| Layer | Where | What |
|---|---|---|
| Pre-filter (deterministic) | `guard.check_user_message` in `routes` | blanks, overlong input, injection shapes → instant refusal, model never called |
| Scope prompt (model-level) | `SYSTEM_PROMPT` via `ensure_system_prompt` in the `agent` node | model only serves Kosply topics; refuses the rest by explaining Kosply |
| Product domain (model-level) | `system_prompt.md` | defines every listing field, the ACTIVE-only search rule, the rupiah price format, and the seller-typed `category` trap, so the model calls `search_catalog` instead of inventing listings |
| Approval gate | `human_approval` node | sensitive tools still need human approve (see `human_in_the_loop.md`) |

## Rejections

| Reason | Reply |
|---|---|
| `injection` | `REJECTION_MESSAGE` — rejects + explains Kosply (marketplace second-hand mahasiswa) + offers relevant help. Bilingual: these are returned verbatim before any model call, so they cannot follow "reply in the user's language" |
| `too_long` (> 2000 chars) | `TOO_LONG_MESSAGE` |
| `empty` | `EMPTY_MESSAGE` |

## Injection shapes caught (EN + ID, case-insensitive)

| Shape | Examples |
|---|---|
| Override instructions | ignore/disregard previous instructions, abaikan/lupakan instruksi, override safety |
| Prompt reveal | reveal/show/tunjukkan system prompt |
| Role hijack | you are now …, kamu sekarang …, DAN/jailbreak/developer mode |
| Fake directives | new instructions:, instruksi baru:, `[SYSTEM]` |

## Rules

| Rule | Notes |
|---|---|
| Refusals are normal flow | HTTP 200 with the explainer (not an error); mirrored to history like any turn |
| Scope text lives in one place | `rules.py` — identity, texts, patterns, `MAX_MESSAGE_LEN` |
| Post-output leak check | TODO (phase next): scan model output for prompt-echo before sending |
