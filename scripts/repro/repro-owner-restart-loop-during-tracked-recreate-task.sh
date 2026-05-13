#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

timeout_bin=""
if command -v timeout >/dev/null 2>&1; then
  timeout_bin="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  timeout_bin="gtimeout"
fi

if [[ -n "$timeout_bin" ]]; then
  exec "$timeout_bin" "${INVOKER_REPRO_TIMEOUT_SECONDS:-900}" \
    env \
      INVOKER_CHAOS_OVERLOAD_SCENARIO=owner-restart-loop-during-tracked-recreate-task \
      ./scripts/e2e-chaos/run-overload.sh
fi

exec env \
  INVOKER_CHAOS_OVERLOAD_SCENARIO=owner-restart-loop-during-tracked-recreate-task \
  ./scripts/e2e-chaos/run-overload.sh
