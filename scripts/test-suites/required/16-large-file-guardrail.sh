#!/usr/bin/env bash
# Guardrail: scripts/check-large-files.mjs must exit non-zero when a
# non-baselined file exceeds the threshold, and when a baselined file grows
# past its pinned cap. The real repo must always pass.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

run_pass() {
  local label="$1"
  shift
  if ! "$@" >/dev/null 2>&1; then
    echo "FAIL [$label]: expected exit 0 from: $*"
    "$@" || true
    exit 1
  fi
  echo "PASS [$label]"
}

run_fail() {
  local label="$1"
  local needle="$2"
  shift 2
  local out
  set +e
  out="$("$@" 2>&1)"
  local ec=$?
  set -e
  if [[ "$ec" -eq 0 ]]; then
    echo "FAIL [$label]: expected non-zero exit from: $*"
    echo "$out"
    exit 1
  fi
  if ! grep -q "$needle" <<<"$out"; then
    echo "FAIL [$label]: expected output to contain: $needle"
    echo "$out"
    exit 1
  fi
  echo "PASS [$label]"
}

# Case 1: real repo passes.
run_pass "real-repo-passes" node scripts/check-large-files.mjs

# Build an isolated fixture sandbox so we never mutate the real tree.
SANDBOX="$(mktemp -d -t invoker-large-file-guardrail.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/scripts" "$SANDBOX/packages/sample/src" "$SANDBOX/packages/sample/dist" "$SANDBOX/packages/sample/__tests__"
cp scripts/check-large-files.mjs "$SANDBOX/scripts/check-large-files.mjs"

# Helper: emit N lines into a target file.
emit_lines() {
  local count="$1"
  local target="$2"
  python3 -c "import sys; n=int(sys.argv[1]); path=sys.argv[2]; open(path,'w').write('\n'.join(f'// line {i}' for i in range(n)) + '\n')" "$count" "$target"
}

# Case 2: a 1800-line non-baselined file fails with exit 1 and names the offender.
echo '{"threshold": 1500, "files": {}}' > "$SANDBOX/scripts/large-files-allowlist.json"
emit_lines 1800 "$SANDBOX/packages/sample/src/oversized.ts"
run_fail "oversized-non-baselined" "exceeds threshold" \
  env INVOKER_LARGE_FILE_ROOTS=packages node "$SANDBOX/scripts/check-large-files.mjs"

# Case 3: a baselined file that grew past its cap fails with "exceeds baseline cap".
emit_lines 1700 "$SANDBOX/packages/sample/src/pinned.ts"
cat > "$SANDBOX/scripts/large-files-allowlist.json" <<'JSON'
{
  "threshold": 1500,
  "files": {
    "packages/sample/src/pinned.ts": 1600
  }
}
JSON
# Remove the unpinned oversized file from case 2 so this case isolates the baseline path.
rm "$SANDBOX/packages/sample/src/oversized.ts"
run_fail "pinned-file-grew" "exceeds baseline cap" \
  env INVOKER_LARGE_FILE_ROOTS=packages node "$SANDBOX/scripts/check-large-files.mjs"

# Case 4: holding a baselined file at its cap passes.
cat > "$SANDBOX/scripts/large-files-allowlist.json" <<'JSON'
{
  "threshold": 1500,
  "files": {
    "packages/sample/src/pinned.ts": 1700
  }
}
JSON
run_pass "pinned-file-at-cap" \
  env INVOKER_LARGE_FILE_ROOTS=packages node "$SANDBOX/scripts/check-large-files.mjs"

# Case 5: generated outputs, tests, and lockfiles are ignored.
emit_lines 3000 "$SANDBOX/packages/sample/dist/built.js"
emit_lines 3000 "$SANDBOX/packages/sample/__tests__/big.test.ts"
emit_lines 3000 "$SANDBOX/pnpm-lock.yaml"
echo '{"threshold": 1500, "files": {}}' > "$SANDBOX/scripts/large-files-allowlist.json"
rm "$SANDBOX/packages/sample/src/pinned.ts"
run_pass "ignored-paths" \
  env INVOKER_LARGE_FILE_ROOTS=packages node "$SANDBOX/scripts/check-large-files.mjs"

# Case 6: stale baseline entry (file no longer exists) fails with a clear message.
cat > "$SANDBOX/scripts/large-files-allowlist.json" <<'JSON'
{
  "threshold": 1500,
  "files": {
    "packages/sample/src/gone.ts": 1700
  }
}
JSON
run_fail "stale-baseline" "no longer exist" \
  env INVOKER_LARGE_FILE_ROOTS=packages node "$SANDBOX/scripts/check-large-files.mjs"

echo "ALL PASS: large-file guardrail enforces threshold, baseline, and exclusions"
