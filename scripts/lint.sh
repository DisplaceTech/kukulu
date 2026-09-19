#!/usr/bin/env bash
# Syntax-only lint: parse every JavaScript module, every shell script, and
# every JSON manifest without executing anything. Zero dependencies, so it runs
# anywhere `npm test` does.

set -euo pipefail

cd "$(dirname "$0")/.."

fail=0
check() {
  if ! "$@" >/dev/null; then
    printf 'lint: FAILED %s\n' "$*" >&2
    fail=1
  fi
}

for f in mcp/*.mjs test/*.mjs scripts/*.mjs; do
  check node --check "$f"
done

for f in scripts/*.sh; do
  check bash -n "$f"
done

for f in package.json .mcp.json .claude-plugin/*.json hooks/*.json templates/*.json templates/ccr/*.json; do
  check node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$f"
done

# Shell scripts the hook system executes must stay executable.
for f in scripts/*.sh; do
  if [ ! -x "$f" ]; then
    printf 'lint: %s is not executable\n' "$f" >&2
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  printf 'lint: ok\n'
fi
exit "$fail"
