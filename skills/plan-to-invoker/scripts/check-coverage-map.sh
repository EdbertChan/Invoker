#!/usr/bin/env bash
set -euo pipefail

assumptions_file="${1:?Usage: bash check-coverage-map.sh <assumptions.json> <coverage-map.json>}"
coverage_map_file="${2:?Usage: bash check-coverage-map.sh <assumptions.json> <coverage-map.json>}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

source_kind="$(jq -r '.sourceKind // "generic"' "$assumptions_file")"
if [[ "$source_kind" != "policy_matrix" ]]; then
  echo "true"
  exit 0
fi

jq -e 'type == "object" and (.mappings | type == "array")' "$coverage_map_file" >/dev/null || {
  echo "coverage map must be an object with a mappings array" >&2
  exit 1
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

expected="$tmpdir/expected.txt"
mapped="$tmpdir/mapped.txt"
missing="$tmpdir/missing.txt"
unexpected="$tmpdir/unexpected.txt"
empty_labels="$tmpdir/empty_labels.txt"
rowtype_mismatches="$tmpdir/rowtype_mismatches.txt"
missing_rationale="$tmpdir/missing_rationale.txt"

jq -r '.coverageItems[] | select(.mustCover != false) | .coverageKey' "$assumptions_file" | sort -u > "$expected"
jq -r '.mappings[]?.coverageKey // empty' "$coverage_map_file" | sort -u > "$mapped"

comm -23 "$expected" "$mapped" > "$missing" || true
comm -13 "$expected" "$mapped" > "$unexpected" || true

jq -r '.mappings[]
  | select((.workflowLabels | type) != "array" or (.workflowLabels | length) == 0 or ([.workflowLabels[] | select(type == "string" and length > 0)] | length) == 0)
  | .coverageKey' "$coverage_map_file" > "$empty_labels" || true

jq -r --slurpfile assumptions "$assumptions_file" '
  ($assumptions[0].coverageItems // []) as $items
  | .mappings[]
  | .coverageKey as $key
  | ($items[] | select(.coverageKey == $key) | .rowType) as $expectedRowType
  | select((.rowType // "") != $expectedRowType)
  | "\($key): expected \($expectedRowType), got \(.rowType // "null")"
' "$coverage_map_file" > "$rowtype_mismatches" || true

jq -r '.mappings[]
  | select(((.rationale // "") | type) != "string" or (((.rationale // "") | gsub("^\\s+|\\s+$"; "")) | length) == 0)
  | .coverageKey' "$coverage_map_file" > "$missing_rationale" || true

if [[ -s "$missing" ]]; then
  echo "coverage map is missing required coverage keys:" >&2
  sed 's/^/  - /' "$missing" >&2
  exit 1
fi

if [[ -s "$unexpected" ]]; then
  echo "coverage map contains unknown coverage keys:" >&2
  sed 's/^/  - /' "$unexpected" >&2
  exit 1
fi

if [[ -s "$empty_labels" ]]; then
  echo "coverage map entries must assign at least one workflow label:" >&2
  sed 's/^/  - /' "$empty_labels" >&2
  exit 1
fi

if [[ -s "$rowtype_mismatches" ]]; then
  echo "coverage map entries must preserve source rowType:" >&2
  sed 's/^/  - /' "$rowtype_mismatches" >&2
  exit 1
fi

if [[ -s "$missing_rationale" ]]; then
  echo "coverage map entries must include a non-empty rationale:" >&2
  sed 's/^/  - /' "$missing_rationale" >&2
  exit 1
fi

echo "true"
