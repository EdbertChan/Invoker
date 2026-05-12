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
#
# INV-117 (status quo explicit CI-matrix mapping, Supported per
# docs/context/inv-117/experiment-brief.md) additionally requires that this
# script remain reachable from the CI `required-fast / Vitest Workspace`
# matrix entry through the same wrapper used locally. Properties this script
# must preserve for INV-117:
#   E5 (INV-117) — root `package.json#test` continues to invoke
#       `bash scripts/workspace-test.sh`, and
#       `scripts/test-suites/required/10-vitest-workspace.sh` continues to
#       `exec pnpm test`. Renaming this file or changing the invocation chain
#       requires a corresponding update so both `grep`s in E5 still exit 0.
#   E6 (INV-117) — the CI-default branch MUST keep the literal lines
#       `CONCURRENCY=1` and
#       `pnpm -r --workspace-concurrency="$CONCURRENCY" test`
#       so a static reviewer can prove the bounded-concurrency contract
#       without executing pnpm. Both lines are matched verbatim by E6.
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
