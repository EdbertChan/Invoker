#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -n "${INVOKER_WORKSPACE_TEST_CONCURRENCY:-}" ]; then
  CONCURRENCY="$INVOKER_WORKSPACE_TEST_CONCURRENCY"
elif [ -n "${CI:-}" ]; then
  CONCURRENCY=1
else
  CONCURRENCY=4
fi

validate_concurrency() {
  local value="$1"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt 1 ]; then
    echo "ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer" >&2
    exit 2
  fi
}

validate_concurrency "$CONCURRENCY"

if [ "${INVOKER_WORKSPACE_TEST_VALIDATE_ONLY:-0}" = "1" ]; then
  echo "==> Running package workspace tests (concurrency=$CONCURRENCY)"
  echo "==> Running required package builds"
  exit 0
fi

echo "==> Running package workspace tests (concurrency=$CONCURRENCY)"
pnpm -r --workspace-concurrency="$CONCURRENCY" test
echo "==> Running required package builds"
bash "$ROOT/scripts/required-builds.sh"
