#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# INV-67 keeps this as fast package-level feedback. The authoritative
# registry gate remains scripts/run-all-tests.sh via package test:all scripts.
if [ -n "${INVOKER_WORKSPACE_TEST_CONCURRENCY:-}" ]; then
  CONCURRENCY="$INVOKER_WORKSPACE_TEST_CONCURRENCY"
elif [ -n "${CI:-}" ]; then
  CONCURRENCY=1
else
  CONCURRENCY=4
fi

pnpm -r --workspace-concurrency="$CONCURRENCY" test
bash "$ROOT/scripts/required-builds.sh"
