#!/usr/bin/env bash
# Opt-in LIVE battle test for the PR-babysitting crons against a scratch
# GitHub repo. Skips cleanly (exit 0) unless INVOKER_BATTLE_REPO is set and
# gh is authenticated. Never runs in CI.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
exec bash "$ROOT/scripts/e2e-chaos/cases/case-pr-babysit-live.sh"
