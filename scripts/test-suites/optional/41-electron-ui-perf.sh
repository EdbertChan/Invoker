#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

export INVOKER_PLAYWRIGHT_WORKERS="${INVOKER_PLAYWRIGHT_WORKERS:-1}"

exec bash scripts/test-suites/optional/40-playwright-app.sh \
  packages/app/e2e/electron-ui-perf-*.spec.ts \
  "$@"
