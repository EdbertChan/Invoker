#!/usr/bin/env bash
# Static large-file guardrail proof.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

exec bash "$ROOT/scripts/test-large-file-guardrail.sh"
