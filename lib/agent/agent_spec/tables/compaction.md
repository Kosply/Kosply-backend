# compaction — implemented

File: `app/agent/memory/compaction/` (`compaction.py`, + `agent` node hook in `graph.py`).
Auto-shrinks long threads so small-window models stop blowing up: older
turns become one summary, recent turns stay verbatim.

| Piece | Details |
|---|---|
| Trigger | over `AI_COMPACTION_MAX_MESSAGES` (default 30) **or** past `AI_COMPACTION_THRESHOLD_PCT` (default 75%) of the total window |
| Total window | `AI_CONTEXT_WINDOW_TOTAL` explicit wins; `0` auto-detects from the provider (`/v1/models`); fallback 32000 |
| Tokenizer | `tiktoken` cl100k_base via `count_tokens` (≈chars/4 fallback without it) |
| Keep window | `AI_COMPACTION_KEEP_RECENT` (default 6) newest messages untouched |
| Rewrite | `RemoveMessage(REMOVE_ALL_MESSAGES)` + summary + kept + answer |
| Summary id | `context-summary` (rolling: summaries re-summarize) |
| Scope safety | scope prompt is id-tagged (`kosply-scope`), never confused with the summary |

## Rules

| Rule | Notes |
|---|---|
| Under budget costs nothing | no summarizer call happens until a budget trips |
| Resume unaffected | checkpoints store the compacted history like any turn |
| Tune per model | tiny windows: lower threshold % or total; big windows: raise them |
