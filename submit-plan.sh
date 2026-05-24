#!/usr/bin/env bash
# Submit a plan YAML to Invoker and execute it (headless mode).
# Uses the same Electron binary as the GUI to avoid ABI mismatches.
#
# Usage: ./submit-plan.sh <plan.yaml>
set -e

if [ -z "$1" ]; then
  echo "Usage: ./submit-plan.sh <plan.yaml>"
  exit 1
fi

PLAN_FILE="$1"
CALLER_PWD="$(pwd)"
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_MAIN="$REPO_ROOT/packages/app/dist/main.js"
ELECTRON_BIN="$REPO_ROOT/packages/app/node_modules/.bin/electron"
cd "$REPO_ROOT"

# Resolve plan path relative to caller's pwd if not absolute
if [[ "$PLAN_FILE" != /* ]]; then
  PLAN_FILE="$CALLER_PWD/$PLAN_FILE"
fi

if [ ! -f "$APP_MAIN" ]; then
  echo "Error: built Electron main process not found at $APP_MAIN" >&2
  echo "Run: pnpm --filter @invoker/app build" >&2
  exit 1
fi

if [ ! -x "$ELECTRON_BIN" ]; then
  echo "Error: Electron binary not found at $ELECTRON_BIN" >&2
  echo "Run: pnpm install" >&2
  exit 1
fi

# Unset ELECTRON_RUN_AS_NODE so Electron loads its full API (not plain Node mode).
# VS Code terminals set this, which breaks electron imports.
unset ELECTRON_RUN_AS_NODE

ELECTRON_FLAGS=()
if [ "$(uname)" = "Linux" ]; then
  SANDBOX_BIN="$REPO_ROOT/node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox"
  # shellcheck disable=SC2086
  if ! stat -c '%U:%a' $SANDBOX_BIN 2>/dev/null | grep -q '^root:4755$'; then
    ELECTRON_FLAGS+=("--no-sandbox")
  fi
fi

if [ "$(uname)" = "Linux" ]; then
  export LIBGL_ALWAYS_SOFTWARE=1
fi

echo "==> Submitting plan: $PLAN_FILE"
"$ELECTRON_BIN" "${ELECTRON_FLAGS[@]}" "$APP_MAIN" --headless run "$PLAN_FILE"
