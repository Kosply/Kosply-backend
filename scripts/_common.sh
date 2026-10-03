#!/usr/bin/env bash
# Shared helpers for the scripts in this directory. Sourced, never executed.
#
#   source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
#
# Keeping this in one place means the colour codes, the env loading and the
# readiness probe behave identically in every script, so a failure in one of
# them is never mistaken for a difference between the components.

# Resolve the project root (parent of scripts/).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Colours, but only when attached to a terminal: CI logs should stay clean.
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_MAGENTA=$'\033[35m'
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''
fi

log()  { printf '%s==>%s %s\n' "$C_BLUE$C_BOLD" "$C_RESET" "$*"; }
ok()   { printf '  %sok%s   %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '  %swarn%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '%serror%s %s\n' "$C_RED$C_BOLD" "$C_RESET" "$*" >&2; exit 1; }
note() { printf '  %s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }

# @notice Fail early if a required executable is absent.
# @dev Called before anything is created, so a missing tool never leaves a
# @dev half-built venv or a half-applied migration behind.
require_cmd() {
  local missing=()
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    die "missing required command(s): ${missing[*]}"
  fi
}

# @notice Export the repository's .env into the current shell.
# @dev dotenv (server) and the agent's own loader both read `.env` relative to
# @dev the CWD, so a script that changes directory would silently lose it.
# @dev Exporting here makes the value visible to every child process regardless
# @dev of CWD. Existing environment variables win, matching dotenv semantics.
load_env() {
  local env_file="${1:-$ROOT/.env}"
  if [ ! -f "$env_file" ]; then
    return 0
  fi
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
  note "loaded $(basename "$env_file")"
}

# @notice Block until an HTTP endpoint answers, or fail.
# @dev Used instead of a fixed `sleep`: a fixed sleep is either too short on a
# @dev cold start (flaky) or wasteful when the service is already up.
# @param {string} url        Endpoint to poll.
# @param {string} label      Name shown in the messages.
# @param {int}    [timeout]  Seconds to wait, default 60.
# @param {int}    [interval] Seconds between attempts, default 1.
wait_for_http() {
  local url="$1" label="$2" timeout="${3:-60}" interval="${4:-1}"
  local waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
      ok "$label is up ($url)"
      return 0
    fi
    sleep "$interval"
    waited=$((waited + interval))
  done
  warn "$label did not answer $url within ${timeout}s"
  return 1
}

# @notice Block until a TCP port accepts connections, or fail.
# @dev For services with no useful health endpoint, and for Postgres.
wait_for_port() {
  local host="$1" port="$2" label="$3" timeout="${4:-60}"
  local waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
      exec 3>&- 2>/dev/null || true
      ok "$label is accepting connections on $host:$port"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  warn "$label never opened $host:$port within ${timeout}s"
  return 1
}

# @notice Run a command with a prefix on every line of its output.
# @dev Keeps interleaved logs from several services readable.
# @param {string} label Colour/prefix tag.
# @param {string} cmd   Command to run.
prefixed() {
  local label="$1"; shift
  local color="$C_MAGENTA"
  "$@" 2>&1 | sed -u "s/^/  ${color}[${label}]${C_RESET} /"
}

# @notice Confirm we are inside the repository, not somewhere unexpected.
assert_repo() {
  [ -f "$ROOT/package.json" ] || die "not a Kosply checkout: $ROOT"
}