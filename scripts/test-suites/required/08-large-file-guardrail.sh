#!/usr/bin/env bash
# Guardrail: production source files must not exceed their line-count ceiling.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
exec bash "$ROOT/scripts/check-large-files.sh"
