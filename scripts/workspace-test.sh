#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EXPERIMENT_BRIEF_REL="docs/context/inv-67/experiment-brief.md"

if [ -n "${INVOKER_WORKSPACE_TEST_CONCURRENCY:-}" ]; then
  CONCURRENCY="$INVOKER_WORKSPACE_TEST_CONCURRENCY"
elif [ -n "${CI:-}" ]; then
  CONCURRENCY=1
else
  CONCURRENCY=4
fi

if ! [[ "$CONCURRENCY" =~ ^[0-9]+$ ]] || [ "$CONCURRENCY" -lt 1 ]; then
  echo "ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer" >&2
  exit 2
fi

echo "==> Running workspace package tests (concurrency=$CONCURRENCY)"
echo "==> Using INV-67 workspace-test threshold from ${EXPERIMENT_BRIEF_REL}"
pnpm -r --workspace-concurrency="$CONCURRENCY" test

echo "==> Running required builds"
bash "$ROOT/scripts/required-builds.sh"
