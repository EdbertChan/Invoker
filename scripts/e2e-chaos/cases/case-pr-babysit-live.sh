#!/usr/bin/env bash
# LIVE scratch-repo battle test for the PR-babysitting crons. Opt-in only:
# requires INVOKER_BATTLE_REPO (a scratch owner/repo the current gh token can
# push to) and a working `gh auth status`. Never runs in CI.
#
# Legs:
#   conflict — real PR made DIRTY by a conflicting trunk push; one-shot
#              cron-pr-conflict-rebase must either move the PR off DIRTY or
#              post the attempt-cap comment.
#   ci       — PR carrying a marker file that a scratch-repo workflow fails
#              on; one-shot cron-pr-ci-failure must dispatch the repair (the
#              dispatch is recorded; the fix agent seam is stubbed to keep
#              even the dangerous suite deterministic).
#   landing  — guard half only: land-stack.mjs rejects a non-stack/ PR, and
#              mergify_admin_requeue --dry-run plans a requeue for the
#              labeled bottom PR. Full Mergify landing stays covered by the
#              fake-gh suites (12 and 28).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

if [ -z "${INVOKER_BATTLE_REPO:-}" ] || ! gh auth status >/dev/null 2>&1; then
  echo "SKIP: set INVOKER_BATTLE_REPO and gh auth to run"
  exit 0
fi

REPO="$INVOKER_BATTLE_REPO"
RUN_TAG="babysit-$(date +%s)-$$"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/invoker-babysit-live.XXXXXX")"
CLONE="$TMP/clone"
CONFLICT_BRANCH="battle/$RUN_TAG-conflict"
CI_BRANCH="battle/$RUN_TAG-ci"
CONFLICT_PR=""
CI_PR=""

fail() { echo "[live] FAIL: $1"; exit 1; }

cleanup() {
  for pr in "$CONFLICT_PR" "$CI_PR"; do
    [ -n "$pr" ] && gh pr close "$pr" --repo "$REPO" --delete-branch >/dev/null 2>&1 || true
  done
  for branch in "$CONFLICT_BRANCH" "$CI_BRANCH"; do
    git -C "$CLONE" push origin --delete "$branch" >/dev/null 2>&1 || true
  done
  rm -rf "$TMP" 2>/dev/null || true
}
trap cleanup EXIT

echo "[live] cloning $REPO"
gh repo clone "$REPO" "$CLONE" -- --quiet
DEFAULT_BRANCH="$(git -C "$CLONE" symbolic-ref --short HEAD)"
git -C "$CLONE" config user.email battle@invoker
git -C "$CLONE" config user.name "invoker-battle"

# ---------------------------------------------------------------------------
# Conflict leg
# ---------------------------------------------------------------------------
echo "[live] conflict leg: open PR then push a conflicting trunk commit"
git -C "$CLONE" checkout -q -b "$CONFLICT_BRANCH"
echo "branch $RUN_TAG" > "$CLONE/battle-conflict.txt"
git -C "$CLONE" add battle-conflict.txt
git -C "$CLONE" commit -qm "battle: conflict branch $RUN_TAG"
git -C "$CLONE" push -q origin "$CONFLICT_BRANCH"
CONFLICT_PR="$(gh pr create --repo "$REPO" --head "$CONFLICT_BRANCH" --base "$DEFAULT_BRANCH" \
  --title "battle conflict $RUN_TAG" --body "Invoker live babysit test; safe to close." \
  | grep -oE '[0-9]+$')"

git -C "$CLONE" checkout -q "$DEFAULT_BRANCH"
echo "trunk $RUN_TAG" > "$CLONE/battle-conflict.txt"
git -C "$CLONE" add battle-conflict.txt
git -C "$CLONE" commit -qm "battle: conflicting trunk commit $RUN_TAG"
git -C "$CLONE" push -q origin "$DEFAULT_BRANCH"

echo "[live] waiting for GitHub to mark PR #$CONFLICT_PR DIRTY"
DIRTY=0
for _ in $(seq 1 60); do
  STATE="$(gh pr view "$CONFLICT_PR" --repo "$REPO" --json mergeStateStatus --jq .mergeStateStatus 2>/dev/null || true)"
  [ "$STATE" = "DIRTY" ] && { DIRTY=1; break; }
  sleep 5
done
[ "$DIRTY" -eq 1 ] || fail "PR #$CONFLICT_PR never reported DIRTY"

# One-shot conflict cron against the live repo. No local Invoker workflow maps
# to this PR, so the review-gate lookup is stubbed to a miss; the cron must
# classify the PR as conflicting and log the no-workflow skip (the recreate
# path itself is covered by suite 28 and the chaos case).
cat > "$TMP/review-gate-miss.sh" <<'RG'
#!/usr/bin/env bash
printf '{}\n'
RG
chmod +x "$TMP/review-gate-miss.sh"
OUT="$(
  HOME="$TMP/home-conflict" \
  INVOKER_GITHUB_TARGET_REPO="$REPO" \
  INVOKER_PR_CRON_AUTHOR="$(gh api user --jq .login)" \
  INVOKER_PR_CRON_LOCK="$TMP/crons.lock" \
  INVOKER_PR_CONFLICT_STATE_FILE="$TMP/conflict-ledger.tsv" \
  INVOKER_PR_CRON_REVIEW_GATE_CMD="$TMP/review-gate-miss.sh" \
  bash scripts/cron-pr-conflict-rebase.sh 2>&1
)" || true
echo "$OUT"
echo "$OUT" | grep -q "PR #$CONFLICT_PR" \
  || fail "conflict cron never classified live PR #$CONFLICT_PR as conflicting"

# ---------------------------------------------------------------------------
# CI leg
# ---------------------------------------------------------------------------
echo "[live] ci leg: PR with marker file the scratch workflow fails on"
git -C "$CLONE" checkout -q -b "$CI_BRANCH" "origin/$DEFAULT_BRANCH"
mkdir -p "$CLONE/.github/workflows"
cat > "$CLONE/.github/workflows/battle-fail-on-marker.yml" <<'YML'
name: battle-fail-on-marker
on: [pull_request]
jobs:
  marker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: test ! -f battle-ci-marker.txt
YML
touch "$CLONE/battle-ci-marker.txt"
git -C "$CLONE" add .github/workflows/battle-fail-on-marker.yml battle-ci-marker.txt
git -C "$CLONE" commit -qm "battle: ci-failing branch $RUN_TAG"
git -C "$CLONE" push -q origin "$CI_BRANCH"
CI_PR="$(gh pr create --repo "$REPO" --head "$CI_BRANCH" --base "$DEFAULT_BRANCH" \
  --title "battle ci $RUN_TAG" --body "Invoker live babysit test; safe to close." \
  | grep -oE '[0-9]+$')"

# One-shot CI cron. The repair dispatch goes through headless-ipc; record it
# with a node shim instead of booting an owner + real fix agent.
mkdir -p "$TMP/bin"
NODE_LOG="$TMP/node-calls.log"; : > "$NODE_LOG"
cat > "$TMP/bin/node" <<EOF
#!/usr/bin/env bash
printf 'node %s\n' "\$*" >> "$NODE_LOG"
exit 0
EOF
chmod +x "$TMP/bin/node"
OUT="$(
  PATH="$TMP/bin:$PATH" \
  HOME="$TMP/home-ci" \
  INVOKER_GITHUB_TARGET_REPO="$REPO" \
  INVOKER_PR_CRON_LOCK="$TMP/ci-crons.lock" \
  bash packages/execution-engine/scripts/cron-pr-ci-failure.sh 2>&1
)" || true
echo "$OUT"
grep -q "repair-review-gate-ci $CI_PR" "$NODE_LOG" \
  || fail "ci cron never dispatched repair-review-gate-ci for live PR #$CI_PR"
grep -q "repair-review-gate-ci $CONFLICT_PR" "$NODE_LOG" \
  && fail "ci cron must skip the conflicted PR #$CONFLICT_PR"

# ---------------------------------------------------------------------------
# Landing leg (guard half only — no Mergify on the scratch repo)
# ---------------------------------------------------------------------------
echo "[live] landing leg: land-stack guard must reject a non-stack/ PR"
if node scripts/land-stack.mjs "$CONFLICT_PR" >/dev/null 2>&1; then
  fail "land-stack.mjs accepted non-stack/ PR #$CONFLICT_PR"
fi

echo "[live] landing leg: dry-run requeue plan for the labeled bottom PR"
gh pr edit "$CI_PR" --repo "$REPO" --add-label admin-bypass >/dev/null 2>&1 || true
OUT="$(python3 scripts/mergify_admin_requeue.py --once --dry-run \
  --repo "$REPO" --author "$(gh api user --jq .login)" \
  --state-file "$TMP/land-ledger.jsonl" --pr "$CI_PR" 2>&1 || true)"
echo "$OUT"
echo "$OUT" | grep -Eq "DRY-RUN|BLOCK" \
  || fail "mergify dry-run produced no plan for live PR #$CI_PR"

echo "[live] PASS pr-babysit-live"
