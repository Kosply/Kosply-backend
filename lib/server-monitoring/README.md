# server-monitoring

Go CLI to test Kosply APIs and control the staging/main servers. Stdlib only, no external dependencies.

## Build

```bash
cd lib/server-monitoring
go build -o kosmon .
```

## Interactive mode (default)

```bash
./kosmon
```

KOSMON block-letter banner first, CLI version below it, then a compact
menu — every option carries its own explanation, with blank lines
separating the title, options and footer. Each menu is a fresh screen:
entering a submenu clears the previous one, so stale menus never
linger above.

```
menu

  > Server control
    API testing
    PM2 status
    Exit

    Start, stop or restart a server

  ↑/↓ move · Enter select · 1-9 jump · q exit
```

Submenus show only their own items. `Back` exists only there and is
merged into the footer line to stay compact. Start asks which env to
bring online; stop/restart act on every active server automatically
(inactive rows render dimmed):

```
server control

    Start server
    Stop server
    Restart server
    Switch environment
    Show states
    Back

    Pick an env to bring online

  ↑/↓ move · Enter select · 1-9 jump · q back
```

Navigate with `↑/↓` + `Enter`; `1-9` jumps directly, `q`/`0` goes back.
Quitting the CLI takes two `Esc` presses so a stray keypress never
kills the session. After an action screen, `Enter` shows the submenu
again while `Esc` jumps straight back to the previous menu.
Piped/non-TTY input falls back to numbered selection automatically.

## Non-interactive mode (scripts / CI)

```bash
./kosmon list
./kosmon test /api/health --env staging
./kosmon test / --env main -m GET
./kosmon start staging
./kosmon stop main
./kosmon restart staging
./kosmon status
./kosmon switch main     # run main, stop staging
./kosmon version
./kosmon help
```

## How it works

- API calls go to `staging :3001` or `main :3000` with a 10s timeout.
  HTTP error statuses are still printed (status + body) instead of failing,
  so broken endpoints are easy to inspect.
- Server control shells out to PM2 from the project root (auto-detected by
  walking up to `ecosystem.config.js`, or set `KOSPLY_ROOT` explicitly).
- `switch <env>` ensures the target is running, then stops the other one.
- Set `NO_COLOR=1` to disable colored output.

## Structure

```
lib/server-monitoring/
  main.go               # dispatch (both modes) + interactive menu loop
  internal/ui/          # banner, menu, table, prompts (house style)
  internal/api/         # endpoint registry + HTTP test client
  internal/server/      # PM2 control (start/stop/restart/switch/status)
  internal/config/      # single source of envs (names, ports, URLs)
```

When new routes are added to `lib/server`, mirror them in
`internal/api/api.go` `Registry()` so `list` and menu testing stay complete.
