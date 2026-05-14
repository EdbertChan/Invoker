#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/src" "$TMP_DIR/dist"

cat > "$TMP_DIR/src/within-limit.ts" <<'EOF'
export const alpha = 1;
export const beta = 2;
export const gamma = 3;
EOF

cat > "$TMP_DIR/src/too-large.ts" <<'EOF'
export const one = 1;
export const two = 2;
export const three = 3;
export const four = 4;
export const five = 5;
EOF

cat > "$TMP_DIR/src/ignored.test.ts" <<'EOF'
export const ignored = 1;
export const ignoredAgain = 2;
export const ignoredThird = 3;
export const ignoredFourth = 4;
export const ignoredFifth = 5;
EOF

cat > "$TMP_DIR/dist/generated.ts" <<'EOF'
export const generated1 = 1;
export const generated2 = 2;
export const generated3 = 3;
export const generated4 = 4;
export const generated5 = 5;
EOF

cat > "$TMP_DIR/pnpm-lock.yaml" <<'EOF'
lockfileVersion: '9.0'
packages:
  sample:
    version: 1.0.0
    resolution: deterministic
EOF

cat > "$TMP_DIR/config.json" <<EOF
{
  "defaultMaxLines": 4,
  "ignoreDirectories": ["dist"],
  "ignoreFiles": ["pnpm-lock.yaml"],
  "ignorePathPrefixes": [],
  "ignorePathSubstrings": [],
  "ignorePathRegexes": [],
  "targets": [
    {
      "root": "${TMP_DIR#"$ROOT"/}",
      "extensions": [".ts"],
      "includePathSubstrings": ["/src/"],
      "ignoreDirectories": [],
      "ignorePathPrefixes": [],
      "ignorePathSubstrings": [],
      "ignorePathRegexes": ["\\\\.test\\\\.ts$"]
    }
  ],
  "overrides": {}
}
EOF

set +e
failure_output="$(node "$ROOT/scripts/check-large-files.mjs" --config "$TMP_DIR/config.json" 2>&1)"
failure_status=$?
set -e

if [[ "$failure_status" -eq 0 ]]; then
  echo "expected oversized fixture to fail the guardrail" >&2
  exit 1
fi

printf '%s\n' "$failure_output" | rg -q 'src/too-large\.ts: 6 lines exceeds max 4'

if printf '%s\n' "$failure_output" | rg -q 'generated\.ts|ignored\.test\.ts|pnpm-lock\.yaml'; then
  echo "guardrail reported ignored files" >&2
  printf '%s\n' "$failure_output" >&2
  exit 1
fi

cat > "$TMP_DIR/config-pass.json" <<EOF
{
  "defaultMaxLines": 6,
  "ignoreDirectories": ["dist"],
  "ignoreFiles": ["pnpm-lock.yaml"],
  "ignorePathPrefixes": [],
  "ignorePathSubstrings": [],
  "ignorePathRegexes": [],
  "targets": [
    {
      "root": "${TMP_DIR#"$ROOT"/}",
      "extensions": [".ts"],
      "includePathSubstrings": ["/src/"],
      "ignoreDirectories": [],
      "ignorePathPrefixes": [],
      "ignorePathSubstrings": [],
      "ignorePathRegexes": ["\\\\.test\\\\.ts$"]
    }
  ],
  "overrides": {}
}
EOF

success_output="$(node "$ROOT/scripts/check-large-files.mjs" --config "$TMP_DIR/config-pass.json" 2>&1)"
printf '%s\n' "$success_output" | rg -q 'all within limits'

echo "PASS: large-file guardrail deterministically catches oversized production sources"
