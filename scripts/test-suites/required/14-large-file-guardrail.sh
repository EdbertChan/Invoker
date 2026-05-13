#!/usr/bin/env bash
# Static production source file length guardrail.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node "$ROOT/scripts/test-large-file-guardrail.mjs"
exec pnpm run check:large-files
