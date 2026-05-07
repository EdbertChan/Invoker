#!/usr/bin/env bash
# LANE: smoke
# OWNER: platform
# Smoke gate: verify build artifacts and test infrastructure are present.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

# 1. pnpm is available
command -v pnpm >/dev/null || { echo "FAIL: pnpm not found"; exit 1; }

# 2. Required build output exists
[ -d packages/surfaces/dist ] || { echo "FAIL: packages/surfaces/dist missing (run required-builds.sh first)"; exit 1; }

# 3. Vitest config resolves
pnpm exec vitest --version >/dev/null 2>&1 || { echo "FAIL: vitest not resolvable"; exit 1; }

echo "PASS: smoke checks passed"
