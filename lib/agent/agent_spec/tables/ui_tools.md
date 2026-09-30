# ui bridge — implemented

Files: `app/agent/tools/ui.py` (+ `read`/`callbacks` in routes, streaming,
server proxy). Lets the model see the Flutter screen and drive it.

## Protocol

| Step | Direction | Details |
|---|---|---|
| 1. Snapshot | Flutter → agent | `ui_state` per turn: screen, visible ids, selection, filters |
| 2. Read | agent | `read_ui_state(query?)` returns the snapshot (or key-filtered slice) |
| 3. Browse | agent | `search_catalog(query?, max_price?, category?)` (tool-side filters) |
| 4. Act | agent → Flutter | `perform_callback(callback, params)` runs only SAFE callbacks; turn `callbacks[]` / SSE `callback` events carry `{callback, args}` |
| 5. Execute | Flutter | runs the callback, renders the result, optionally replies |
| 6. Risky acts | agent → approval | buy/delete/contact stay in sensitive tools behind interrupt |

## Safe callbacks (Flutter implements)

`open_product`, `show_product`, `apply_filter`, `clear_filter`,
`scroll_to`, `highlight`, `show_toast`, `open_chat`,
`focus_input`, `open_screen`.

## Click conventions (Flutter exposes, agent reads)

| Element | `id` shape | Example |
|---|---|---|
| Catalog card | `product:<id>` | `product:dev-product-1` |
| Any input | `input:<name>` | `input:bio`, `input:search` |
| Buttons | `btn:<action>[:<target>]` | `btn:chat:dev-product-1`, `btn:send` |

Clicks arrive as `ui_state.last_click = {id, kind}`; `read_ui_state` resolves
them against `ui_state.elements`.

## Nego flow (catalog detail → read → chat → AI negotiates)

1. User opens catalog detail → Flutter sends snapshot (card `product:<id>`).
2. User taps chat (`btn:chat:<id>`) → AI calls `open_chat`, Flutter opens the
   conversation UI.
3. AI reads the room (`read_conversation`), discusses strategy in the AI panel.
4. On user approval, AI sends via `send_chat_message` (sender = state user).
5. Seller reply → next turn reads the updated room, loop continues.

## Rules

| Rule | Notes |
|---|---|
| Unknown callbacks never run | tool returns guidance text; the model asks the user instead |
| Tool-side `params`, Flutter-side `args` | `args` collides with a langchain internal; the payload key stays `args` |
| Snapshots are per-turn | latest `ui_state` overwrites state; checkpoints stay small |
| Persona still applies | scope + role prompt wraps every turn, UI or not |
