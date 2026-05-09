#!/usr/bin/env bash
# Large-file guardrail: production source files must not exceed the line limit.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
exec bash "$ROOT/scripts/check-large-files.sh"
