#!/usr/bin/env bash
# Large-file guardrail: production files must stay within size limits.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
exec bash "$ROOT/scripts/check-file-size-limits.sh"
