#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

exec bash scripts/test-suites/optional/40-playwright-app.sh \
  packages/app/e2e/electron-ui-perf-harness.spec.ts \
  "$@"
