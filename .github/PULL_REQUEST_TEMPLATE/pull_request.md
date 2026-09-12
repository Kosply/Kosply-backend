# Kosply pull request

## What

<!-- One paragraph: what changed and why. -->

## Type

<!-- Tick one: `feat` / `fix` / `docs` / `chore`. -->

- [ ] feat (new endpoint, command, or behavior)
- [ ] fix (bug fix, no behavior change otherwise)
- [ ] docs
- [ ] chore (CI, scripts, refactor without behavior change)

## Staging evidence (required for runtime changes)

<!-- Paste kosmon output proving staging passes BEFORE main is touched. -->

```text
$ ./kosmon test /api/health --env staging
(paste result here)
```

## Checklist

- [ ] Staging passes (`:3001` green) — main was NOT touched before that
- [ ] Server: `node --check` clean on touched files
- [ ] CLI: `gofmt`, `go vet ./...`, `go build` clean
- [ ] `scripts/server.sh` still works (`bash -n` clean)
- [ ] READMEs updated (`lib/server`, `lib/server-monitoring`, root if needed)
- [ ] New routes mirrored in `kosmon` `Registry()` (or N/A)
