#!/usr/bin/env bash
# Deterministic proof for the large-file regression guardrail.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
exec bash "$ROOT/scripts/test-large-file-guardrail.sh"
