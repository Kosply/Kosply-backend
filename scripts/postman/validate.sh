#!/usr/bin/env bash
#
# @title Keep the Postman collection honest
# @notice Fails when the collection drifts from the Express routes.
# @dev The catalog was maintained by hand in two places -- a Postman collection
# @dev JSON and a mirror of `.request.yaml` files -- with nothing checking either
# @dev against the code. They drifted apart (62 requests vs 57) and both fell
# @dev behind the server: the whole analytics POC was missing, the seller review
# @dev URL had a literal `:id` that could never resolve, and every internal
# @dev request omitted `x-internal-key` so each one was a guaranteed 401.
# @dev This reads the routes straight out of `lib/server/routes/` and compares.
#
# Usage: ./scripts/postman/validate.sh [--fix-hints]
#
set -euo pipefail

# shellcheck source=../_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../_common.sh"
assert_repo

COLLECTION="$ROOT/postman/Kosply-API.postman_collection.json"
REQUEST_DIR="$ROOT/postman/collections"
FAILED=0

fail() { printf '  %sFAIL%s %s\n' "$C_RED$C_BOLD" "$C_RESET" "$*"; FAILED=1; }
pass() { printf '  %sok%s   %s\n' "$C_GREEN" "$C_RESET" "$*"; }

[ -f "$COLLECTION" ] || die "missing $COLLECTION"

log "Reading routes from lib/server/routes"
# Extract {method, path} straight from the router definitions, using the same
# prefixes routes/index.js mounts. Written in Node because that is where the
# route files already are parsed correctly.
ROUTES="$(cd "$ROOT" && node -e '
const fs = require("fs"), path = require("path");
const idx = fs.readFileSync("lib/server/routes/index.js", "utf8");
const varFile = {};
for (const m of idx.matchAll(/const (\w+)\s*=\s*require\(.([^"\x27]+)./g)) varFile[m[1]] = m[2];
const prefixOf = {};
for (const m of idx.matchAll(/router\.use\(.([^\x27]+).,\s*(\w+)\)/g))
  if (!(m[2] in prefixOf)) prefixOf[m[2]] = m[1];
const out = [];
for (const [v, p] of Object.entries(prefixOf)) {
  const rel = varFile[v];
  if (!rel) continue;
  const f = path.join("lib/server/routes", rel + ".js");
  if (!fs.existsSync(f)) continue;
  for (const m of fs.readFileSync(f, "utf8")
        .matchAll(/router\.(get|post|patch|put|delete)\(\s*[\x27`]([^\x27`]+)[\x27`]/g)) {
    out.push({ method: m[1].toUpperCase(), path: p + (m[2] === "/" ? "" : m[2]) });
  }
}
console.log(JSON.stringify(out));
')" || die "could not parse routes"

log "Checking coverage"
RESULT="$(cd "$ROOT" && node -e '
const fs = require("fs"), path = require("path");
const routes = JSON.parse(process.argv[1]);

// Normalise a URL to a comparable shape: drop host, query and /api prefix,
// then collapse every variable or parameter to :x.
const norm = (u) => {
  let s = String(u).replace(/^https?:\/\/[^/]+/, "").split("?")[0].replace(/\/$/, "");
  s = s.replace(/\{\{baseUrl\}\}/g, "").replace(/^\/api/, "");
  s = s.replace(/\/+/g, "/").replace(/\/$/, "");
  s = s.replace(/\{\{[^}]*\}\}/g, ":x").replace(/:[A-Za-z_]+/g, ":x");
  return s || "/";
};
const key = (m, p) => m + " " + p;

const problems = { missingJson: [], missingYaml: [], phantom: [], noInternalKey: [], brokenUrl: [] };

const real = new Set(routes.map((r) => key(r.method, norm(r.path))));

// --- Postman collection JSON ---
const coll = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const seenJson = new Set();
const walkJson = (items) => {
  for (const it of items) {
    if (it.item) { walkJson(it.item); continue; }
    if (!it.request) continue;
    const raw = it.request.url?.raw
      || "/" + (Array.isArray(it.request.url?.path) ? it.request.url.path.join("/") : (it.request.url?.path || ""));
    const k = key((it.request.method || "GET").toUpperCase(), norm(raw));
    seenJson.add(k);
    // A literal :param outside {{...}} is a placeholder that never resolves.
    const tail = String(raw).split("?")[0];
    if (/:[A-Za-z_]+/.test(tail)) problems.brokenUrl.push(`${it.name}: ${raw}`);
    // Every internal call is behind x-internal-key; without it, it is a 401.
    if (String(raw).includes("/api/internal/")) {
      const hs = (it.request.header || []).map((h) => (h.key || "").toLowerCase());
      if (!hs.includes("x-internal-key")) problems.noInternalKey.push(it.name);
    }
  }
};
walkJson(coll.item);
for (const k of real) if (!seenJson.has(k)) problems.missingJson.push(k);
for (const k of seenJson) if (!real.has(k) && k !== "GET /") problems.phantom.push(k);

// --- .request.yaml mirror ---
const walkYaml = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walkYaml(p) : (e.name.endsWith(".yaml") ? [p] : []);
});
const seenYaml = new Set();
for (const f of walkYaml(process.argv[3])) {
  const s = fs.readFileSync(f, "utf8");
  const m = s.match(/^method:\s*(\w+)/m), u = s.match(/^url:\s*[\x27\"]?([^\n\x27\"]+)/m);
  if (!m || !u) continue;
  const k = key(m[1].toUpperCase(), norm(u[1]));
  seenYaml.add(k);
  if (String(u[1]).includes("/api/internal/") && !s.includes("x-internal-key"))
    problems.noInternalKey.push(path.basename(f));
}
for (const k of real) if (!seenYaml.has(k)) problems.missingYaml.push(k);

console.log(JSON.stringify({ ...problems, realCount: real.size, jsonCount: seenJson.size, yamlCount: seenYaml.size }));
' "$ROUTES" "$COLLECTION" "$REQUEST_DIR")" || die "could not check the collection"

echo "$RESULT" | node -e '
const r = JSON.parse(require("fs").readFileSync(0, "utf8"));
let bad = 0;
const line = (label, items) => {
  if (!items.length) return;
  bad += items.length;
  console.log(`  \x1b[31mFAIL\x1b[0m ${label} (${items.length})`);
  items.forEach((i) => console.log(`         ${i}`));
};
line("in the server but not in the collection JSON", r.missingJson);
line("in the server but not in the yaml mirror", r.missingYaml);
line("in the collection but not in the server (phantom)", r.phantom);
line("unresolvable {{...}} placeholder left as a literal :param", r.brokenUrl);
line("internal request missing x-internal-key (would 401)", r.noInternalKey);
if (!bad) console.log(`  \x1b[32mok\x1b[0m   all ${r.realCount} routes covered by both formats (json ${r.jsonCount}, yaml ${r.yamlCount})`);
process.exit(bad ? 1 : 0);
' || FAILED=1

if [ "$FAILED" -eq 0 ]; then
  ok "postman catalog is in sync with the server"
else
  die "postman catalog has drifted; fix the entries listed above (or regenerate them)"
fi