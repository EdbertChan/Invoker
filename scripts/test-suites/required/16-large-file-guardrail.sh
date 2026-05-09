#!/usr/bin/env bash
# Large-file guardrail — prevents production source files from exceeding
# line-count thresholds.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
exec bash "$ROOT/scripts/check-large-files.sh"
