#!/usr/bin/env bash
# LANE: e2e
# OWNER: e2e
# Headless Electron case scripts, shard 1 (case-1.*).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
exec bash "$ROOT/scripts/e2e-dry-run/run-all.sh" 'case-1.*.sh'
