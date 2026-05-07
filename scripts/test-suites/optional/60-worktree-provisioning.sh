#!/usr/bin/env bash
# LANE: infra
# OWNER: infra
# Fresh git worktree + pnpm install --frozen-lockfile (slow; validates provisioning).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
exec bash "$ROOT/scripts/test-worktree-provisioning.sh"
