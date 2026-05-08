#!/usr/bin/env bash
# Guardrail: production source files must not exceed their allowed line counts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
bash "$ROOT/scripts/check-large-files.sh"
