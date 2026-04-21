#!/usr/bin/env bash
set -euo pipefail

coverage_map_file="${1:?Usage: bash check-stack-manifest.sh <coverage-map.json> <stack-manifest.json>}"
stack_manifest_file="${2:?Usage: bash check-stack-manifest.sh <coverage-map.json> <stack-manifest.json>}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

jq -e 'type == "object" and (.mappings | type == "array")' "$coverage_map_file" >/dev/null || {
  echo "coverage map must be an object with a mappings array" >&2
  exit 1
}

jq -e 'type == "object" and (.workflows | type == "array")' "$stack_manifest_file" >/dev/null || {
  echo "stack manifest must be an object with a workflows array" >&2
  exit 1
}

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

declared_labels="$tmpdir/declared_labels.txt"
manifest_labels="$tmpdir/manifest_labels.txt"
missing_labels="$tmpdir/missing_labels.txt"
empty_labels="$tmpdir/empty_labels.txt"
duplicate_labels="$tmpdir/duplicate_labels.txt"
missing_plan_files="$tmpdir/missing_plan_files.txt"

jq -r '.mappings[]?.workflowLabels[]? // empty' "$coverage_map_file" | sort -u > "$declared_labels"
jq -r '.workflows[]?.label // empty' "$stack_manifest_file" | sort -u > "$manifest_labels"

comm -23 "$declared_labels" "$manifest_labels" > "$missing_labels" || true

jq -r '.workflows[]
  | select(((.label // "") | type) != "string" or (((.label // "") | gsub("^\\s+|\\s+$"; "")) | length) == 0)
  | (.planFile // "<unknown-plan>")' "$stack_manifest_file" > "$empty_labels" || true

jq -r '.workflows[]?.label // empty' "$stack_manifest_file" | sort | uniq -d > "$duplicate_labels" || true

jq -r '.workflows[]
  | select(((.planFile // "") | type) != "string" or (((.planFile // "") | gsub("^\\s+|\\s+$"; "")) | length) == 0)
  | (.label // "<unknown-label>")' "$stack_manifest_file" > "$missing_plan_files" || true

if [[ -s "$empty_labels" ]]; then
  echo "stack manifest workflows must include a non-empty label:" >&2
  sed 's/^/  - /' "$empty_labels" >&2
  exit 1
fi

if [[ -s "$duplicate_labels" ]]; then
  echo "stack manifest workflow labels must be unique:" >&2
  sed 's/^/  - /' "$duplicate_labels" >&2
  exit 1
fi

if [[ -s "$missing_plan_files" ]]; then
  echo "stack manifest workflows must include a non-empty planFile:" >&2
  sed 's/^/  - /' "$missing_plan_files" >&2
  exit 1
fi

if [[ -s "$missing_labels" ]]; then
  echo "coverage map references workflow labels not present in the stack manifest:" >&2
  sed 's/^/  - /' "$missing_labels" >&2
  exit 1
fi

echo "true"
