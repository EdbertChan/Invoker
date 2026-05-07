#!/usr/bin/env bash
# LANE: integration
# OWNER: workflow
# Deterministic unit-style coverage for headless workflow-chain submit script.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
exec bash "$ROOT/scripts/test-submit-workflow-chain.sh"

