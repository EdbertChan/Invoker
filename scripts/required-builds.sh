#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export INVOKER_REQUIRED_BUILDS_SKIP_DTS=1

pnpm --filter @invoker/surfaces build
pnpm --filter @invoker/transport build
