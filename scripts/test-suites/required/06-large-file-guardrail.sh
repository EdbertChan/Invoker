#!/usr/bin/env bash
# Static large-file guardrail and deterministic oversized-sample proof.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node "$ROOT/scripts/check-large-files.mjs"
node "$ROOT/scripts/test-large-file-guardrail.mjs"
