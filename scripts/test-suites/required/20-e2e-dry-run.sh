#!/usr/bin/env bash
# Headless Electron case scripts, shard 1 (case-1.*).
#
# Design verdict: Supported (status quo three-shard split) per
# docs/context/inv-119/experiment-brief.md.
# This is the case-1 member of a three-shard partition over
# scripts/e2e-dry-run/cases/case-*.sh; siblings are
#   scripts/test-suites/required/21-e2e-dry-run-downstream.sh (case-2.*)
#   scripts/test-suites/required/22-e2e-dry-run-github.sh    (case-4.*)
# Properties this wrapper must preserve (any change must keep these passing):
#   E3 — single `exec bash …/run-all.sh 'case-1.*.sh'` line; no other test
#        execution statements.
#   E4 — `case-1.*.sh ∪ case-2.*.sh ∪ case-4.*.sh == cases/case-*.sh`.
#   E5 — pairwise glob intersections are empty.
# Rejected alternatives (do not regress toward these without re-running the
# experiment): Alt A (single dry-run job, no glob) and Alt B (one matrix
# entry per case). Auto-discovery of family prefixes is Deferred until a
# third family (`case-3.*`/`case-5.*`) is introduced.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
exec bash "$ROOT/scripts/e2e-dry-run/run-all.sh" 'case-1.*.sh'
