#!/usr/bin/env bash
# Submit a plan YAML to Invoker and execute it (headless mode).
# Route through run.sh so headless submissions share the same bootstrap and
# owner-delegation path as the rest of the CLI surface.
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
cd "$REPO_ROOT"

# Resolve plan path relative to caller's pwd if not absolute
if [[ "$PLAN_FILE" != /* ]]; then
  PLAN_FILE="$CALLER_PWD/$PLAN_FILE"
fi

echo "==> Submitting plan: $PLAN_FILE"
./run.sh --headless run "$PLAN_FILE"
