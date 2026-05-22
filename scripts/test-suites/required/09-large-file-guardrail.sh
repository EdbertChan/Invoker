#!/usr/bin/env bash
# Deterministic large-file guardrail and oversized fixture proof.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

pnpm run check:large-files
node scripts/test-large-file-guardrail.mjs
