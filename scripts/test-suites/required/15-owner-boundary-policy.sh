#!/usr/bin/env bash
# LANE: guardrail
# OWNER: platform
# Static owner-boundary policy checks.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
exec bash "$ROOT/scripts/check-owner-boundary.sh"
