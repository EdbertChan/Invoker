#!/usr/bin/env bash
# Proves the deterministic large-file guardrail and checks the current repo.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

bash "$ROOT/scripts/test-large-file-guardrail.sh"
node "$ROOT/scripts/check-large-files.mjs"
