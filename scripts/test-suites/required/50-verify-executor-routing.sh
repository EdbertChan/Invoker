#!/usr/bin/env bash
# LANE: integration
# OWNER: executor
# Headless submit-plan + fixture config for executor routing.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
exec bash "$ROOT/scripts/verify-executor-routing.sh"
