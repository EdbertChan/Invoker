#!/usr/bin/env bash
# Guardrail: production source files must stay below the large-file threshold.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node scripts/test-large-file-guardrail.mjs
node scripts/check-large-files.mjs
