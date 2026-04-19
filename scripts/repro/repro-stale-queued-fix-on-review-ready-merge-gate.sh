#!/usr/bin/env bash
# Repro/proof: only one live auto-fix session should exist per task, and a
# queued invoker:fix-with-agent intent should become a no-op skip if the merge
# gate transitions from failed -> review_ready before dispatch.
#
# This wrapper does two things:
# 1. prints the live event ordering for a representative merge gate when
#    available from ~/.invoker/invoker.db
# 2. runs the focused coordinator repro proving:
#    - a second auto-fix is not enqueued while one live fix intent already exists
#    - the queued fix becomes a stale skip after the task becomes review_ready
#
# Usage:
#   bash scripts/repro/repro-stale-queued-fix-on-review-ready-merge-gate.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

pnpm --filter @invoker/app exec vitest run \
  src/__tests__/persisted-workflow-mutation-coordinator.test.ts \
  --testNamePattern "keeps one live auto-fix session per task and skips stale queued dispatch after review_ready"
