#!/usr/bin/env bash
# Static large-file guardrail and deterministic failure proof.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

node "$ROOT/scripts/check-large-files.mjs"
exec bash "$ROOT/scripts/test-large-file-guardrail.sh"
