#!/usr/bin/env bash
# Submit a plan YAML to Invoker through the shared headless owner.
# Uses the headless client entrypoint so mutating submissions bootstrap and
# delegate instead of becoming an independent writer.
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

# Unset ELECTRON_RUN_AS_NODE so Electron loads its full API (not plain Node mode)
# when the headless client launches Electron. VS Code terminals set this, which
# breaks electron imports.
unset ELECTRON_RUN_AS_NODE
# This entrypoint is a client, not the long-lived owner process. Avoid carrying
# a caller's standalone-owner environment into plan submission.
unset INVOKER_HEADLESS_STANDALONE

echo "==> Submitting plan: $PLAN_FILE"
./run.sh --headless run "$PLAN_FILE"
