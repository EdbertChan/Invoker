#!/usr/bin/env bash
# INV-67 workspace-wide vitest driver.
#
# Design verdict: Supported (status quo) per docs/context/inv-67/experiment-brief.md.
# Property this script must preserve:
#   E2 — `pnpm test` runs every workspace package's `vitest run` under a bounded
#        concurrency. Default is 4 locally and 1 under `CI=1`;
#        `INVOKER_WORKSPACE_TEST_CONCURRENCY` overrides both.
# Threshold: exit 0 and zero failing packages, identical pass/fail verdict at
# `CONCURRENCY=1` vs the default — only wall-clock may differ.
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

pnpm -r --workspace-concurrency="$CONCURRENCY" test
bash "$ROOT/scripts/required-builds.sh"
