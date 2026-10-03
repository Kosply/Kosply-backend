# human-in-the-loop — implemented

Gate: `human_approval` node in `graph.py`. Only tools in `SENSITIVE_TOOLS`
pause; everything else flows straight to `tools`.

| Step | Actor | What happens |
|---|---|---|
| 1. Model emits tool call | graph | `tools_condition` → `human_approval` |
| 2a. Plain tool | graph | `Command(goto="tools")`, no pause |
| 2b. Sensitive tool | graph | `interrupt({pending_tools: [{name, args}]})` → run pauses, state persisted |
| 3. Client shows approve/reject | Flutter | from `409 needs_approval` (invoke) or `interrupt` SSE event (stream) |
| 4a. Approve | client → `POST /ai/chat/resume {approve: true}` | `Command(resume="approve")` → tool runs → agent answers |
| 4b. Reject | client → `POST /ai/chat/resume {approve: false}` | `Command(resume="reject")` → `ToolMessage("User rejected…")` → agent answers without running the tool |
| 5. Wait instead of blocking UI | client → `GET /ai/wait/{conversation_id}?timeout=N` | Long-polls the checkpoint every 1s; returns the moment the interrupt clears, with `remainingS` |

## What approval does and does not cover

Approving is consent for **the action**, never for **an identity**. The acting
user for `send_chat_message` and `request_seller_contact` is read from graph
state (`user_id`, injected via `InjectedState`), never from the model's tool
arguments. If it came from the arguments, approval would turn "send this
message" into "send this message AS anyone".

| Property | Pinned by |
|---|---|
| Sensitive tools pause; read-only ones do not | `tests/graph/test_graph.py`, `test_approval_identity.py` |
| Approved action acts as the session user | `test_approval_identity.py::test_approved_send_acts_as_the_session_user` |
| A model-supplied `senderId` is ignored | `test_model_cannot_choose_the_acting_user` |
| No session user ⇒ nothing is sent, even when approved | `test_approved_send_without_a_session_sends_nothing` |
| Rejected ⇒ the network is never touched | `test_rejected_action_never_touches_the_network` |
| `perform_callback` is not gated | it is allow-listed to `SAFE_CALLBACKS` (navigation only); anything that writes goes through a sensitive tool |

## Approval wait

`GET /ai/wait/{conversation_id}?timeout=N` (`_wait_for_resolution` in
`app/api/shared.py`) turns the pause into an event-based wait:

| Field | Meaning |
|---|---|
| `status` | `resolved` (approval landed), `timeout` (budget spent), `noop` (nothing pending) |
| `answer` | Last AI answer once resolved; empty on `timeout`/`noop` |
| `remainingS` | Seconds left of the budget, so callers can chain: 25 min total, reply at 2 min → `remainingS` ≈ 1380 |

`timeout` is clamped to 1..1500 s. Example: user asked for a 25 minute wait;
the seller approves after 2 minutes; the endpoint returns ~2 s later with
`status: resolved` and `remainingS: 1380`, and the AI answer is already there.

## Rules

| Rule | Notes |
|---|---|
| Chained interrupts | if another sensitive call fires after resume, the API returns `409` again (client loops) |
| Rejected tools | never execute; the rejection is recorded in history as a `ToolMessage` |
| Nothing pending | `noop` returns immediately, never blocks a fresh or finished thread |
| Clearing without an answer | interrupt gone but no AI text yet → keeps polling until the deadline, then `timeout` |
| Blocking cost | holds one async worker per waiter; prefer `timeout<=60` loops or push in production |
| Phone background | long waits need the Flutter app alive: Android foreground service / iOS background mode + push |

## Notes

- `X-Accel-Buffering: no` is not needed here (JSON long-poll, not SSE).
- Express disables `requestTimeout`/`headersTimeout` so Node does not cut a
  25-minute wait; any reverse proxy in front must raise its own limits too.
- Compose with Flutter background execution:
  1. Start `wait` with the full budget (e.g. 1500 s).
  2. Keep the screen listening; if the OS suspends the app, the server keeps
     the checkpoint and push/`GET /ai/wait` re-attach later.
  3. When `resolved`, the approval request is rendered from the interrupt the
     user already approved; the answer text comes from this same response.

