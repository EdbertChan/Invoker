#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONCURRENCY_SOURCE="local default"
if [ -n "${INVOKER_WORKSPACE_TEST_CONCURRENCY:-}" ]; then
  CONCURRENCY="$INVOKER_WORKSPACE_TEST_CONCURRENCY"
  CONCURRENCY_SOURCE="INVOKER_WORKSPACE_TEST_CONCURRENCY"
elif [ -n "${CI:-}" ]; then
  CONCURRENCY=1
  CONCURRENCY_SOURCE="CI"
else
  CONCURRENCY=4
fi

if ! [[ "$CONCURRENCY" =~ ^[0-9]+$ ]] || [ "$CONCURRENCY" -lt 1 ]; then
  echo "ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer" >&2
  exit 2
fi

echo "==> Running package workspace tests (concurrency=$CONCURRENCY, source=$CONCURRENCY_SOURCE)"
pnpm -r --workspace-concurrency="$CONCURRENCY" test
echo "==> Running required package builds"
bash "$ROOT/scripts/required-builds.sh"
