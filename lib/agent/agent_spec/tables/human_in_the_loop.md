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

## Rules

| Rule | Notes |
|---|---|
| Chained interrupts | if another sensitive call fires after resume, the API returns `409` again (client loops) |
| Rejected tools | never execute; the rejection is recorded in history as a `ToolMessage` |
