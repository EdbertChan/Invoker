#!/usr/bin/env bash
# Static large-file guardrail and deterministic fixture proof.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

bash "$ROOT/scripts/test-large-file-guardrail.sh"
pnpm run check:large-files
