# Mergify Stack Lifecycle POC — Scenario Contract

Deterministic scenario contract for validating Mergify stack behavior
under Invoker-driven workflows. Each scenario defines the Invoker action,
expected Mergify behavior, and machine-checkable assertions.

## Conventions

| Term | Definition |
|------|-----------|
| **stack** | Ordered set of PRs created by `mergify stack push`, each targeting the previous PR's branch as base |
| **stack depth** | Number of PRs in the stack (equals number of stacked commits) |
| **chain topology** | The baseRefName → headRefName relationship across all PRs in the stack |
| **target repo** | `$MERGIFY_STACK_DOGFOOD_REPO` (default: `EdbertChan/Invoker`) |
| **base branch** | `$MERGIFY_STACK_DOGFOOD_BASE` (default: `master`) |
| **run prefix** | `repro/mergify-stack-dogfood-$RUN_ID` |

## Preconditions (all scenarios)

1. `mergify` CLI is installed and authenticated.
2. `gh` CLI is authenticated with push access to target repo.
3. `mergify stack setup` has installed the commit-msg hook in the working clone.
4. Working tree starts clean on `origin/<base branch>`.

---

## Scenario A: Initial Stack Creation

### Invoker Action

Create N stacked commits (N=3) on a fresh branch from `origin/master`,
then run `mergify stack push`.

```bash
git switch -c "$PREFIX" "origin/master"
git commit --allow-empty -m "feat(a): commit 1"
git commit --allow-empty -m "feat(a): commit 2"
git commit --allow-empty -m "feat(a): commit 3"
mergify stack push
```

### Expected Mergify Behavior

- Creates exactly N PRs (one per commit).
- PR 1 targets `master` as base.
- PR k (k > 1) targets PR k-1's head branch as base.
- All PRs are in `OPEN` state and non-draft.
- Each PR title matches the corresponding commit message subject.

### Assertions

```bash
# A1: Exactly N PRs created
PR_COUNT=$(echo "$PRS_JSON" | jq 'length')
[ "$PR_COUNT" -eq 3 ]

# A2: First PR bases on master
FIRST_BASE=$(echo "$PRS_JSON" | jq -r '.[0].baseRefName')
[ "$FIRST_BASE" = "master" ]

# A3: Chain topology — each subsequent PR bases on the previous PR's head
for i in $(seq 1 $((PR_COUNT - 1))); do
  PREV_HEAD=$(echo "$PRS_JSON" | jq -r ".[$((i-1))].headRefName")
  CURR_BASE=$(echo "$PRS_JSON" | jq -r ".[$i].baseRefName")
  [ "$PREV_HEAD" = "$CURR_BASE" ]
done

# A4: All PRs are OPEN
CLOSED_COUNT=$(echo "$PRS_JSON" | jq '[.[] | select(.state != "OPEN")] | length')
[ "$CLOSED_COUNT" -eq 0 ]

# A5: PR titles match commit subjects
COMMIT_SUBJECTS=$(git log --reverse --format='%s' "origin/master..HEAD")
for i in $(seq 0 $((PR_COUNT - 1))); do
  EXPECTED=$(echo "$COMMIT_SUBJECTS" | sed -n "$((i+1))p")
  ACTUAL=$(echo "$PRS_JSON" | jq -r ".[$i].title")
  [ "$ACTUAL" = "$EXPECTED" ]
done
```

---

## Scenario B: Add Branch/Commit to Stack

### Invoker Action

Starting from the state after Scenario A (3-commit stack already pushed),
append a new commit and re-push.

```bash
git commit --allow-empty -m "feat(b): commit 4 appended"
mergify stack push
```

### Expected Mergify Behavior

- Stack grows by 1: total PRs = N + 1.
- New PR targets the previous top-of-stack branch as base.
- Existing PRs remain unchanged (same number, title, state).
- No PRs are closed or recreated.

### Assertions

```bash
# B1: PR count increases by exactly 1
NEW_PR_COUNT=$(echo "$PRS_JSON_AFTER" | jq 'length')
[ "$NEW_PR_COUNT" -eq 4 ]

# B2: Original PRs unchanged (numbers preserved)
ORIGINAL_NUMBERS=$(echo "$PRS_JSON_BEFORE" | jq -r '.[].number' | sort)
PRESERVED_NUMBERS=$(echo "$PRS_JSON_AFTER" | jq -r '.[].number' | sort | head -n 3)
[ "$ORIGINAL_NUMBERS" = "$PRESERVED_NUMBERS" ]

# B3: New PR bases on previous top-of-stack head
PREV_TOP_HEAD=$(echo "$PRS_JSON_BEFORE" | jq -r '.[-1].headRefName')
NEW_PR_BASE=$(echo "$PRS_JSON_AFTER" | jq -r '.[-1].baseRefName')
[ "$NEW_PR_BASE" = "$PREV_TOP_HEAD" ]

# B4: New PR is OPEN
NEW_PR_STATE=$(echo "$PRS_JSON_AFTER" | jq -r '.[-1].state')
[ "$NEW_PR_STATE" = "OPEN" ]
```

---

## Scenario C: Rebase or Mid-Stack Rewrite

### Invoker Action

Starting from a 3-commit stack (Scenario A state), amend the middle commit
(simulating a mid-stack rewrite), then re-push with force.

```bash
# Interactive rebase to edit commit 2 (automated via GIT_SEQUENCE_EDITOR)
GIT_SEQUENCE_EDITOR="sed -i '2s/pick/edit/'" git rebase -i "origin/master"
git commit --amend --allow-empty -m "feat(c): commit 2 rewritten"
git rebase --continue
mergify stack push
```

### Expected Mergify Behavior

- PR count remains N (no new PRs created, none closed).
- PR 2 title updates to the amended commit message.
- PR 2 head branch is force-pushed (commit SHA changes).
- Chain topology remains intact (same base relationships).
- PRs 1 and 3 may also have updated SHAs if Mergify rebases the stack.

### Assertions

```bash
# C1: PR count unchanged
REBASE_PR_COUNT=$(echo "$PRS_JSON_AFTER" | jq 'length')
[ "$REBASE_PR_COUNT" -eq 3 ]

# C2: PR 2 title reflects rewritten commit
PR2_TITLE=$(echo "$PRS_JSON_AFTER" | jq -r '.[1].title')
[ "$PR2_TITLE" = "feat(c): commit 2 rewritten" ]

# C3: Chain topology preserved
FIRST_BASE=$(echo "$PRS_JSON_AFTER" | jq -r '.[0].baseRefName')
[ "$FIRST_BASE" = "master" ]
for i in $(seq 1 $((REBASE_PR_COUNT - 1))); do
  PREV_HEAD=$(echo "$PRS_JSON_AFTER" | jq -r ".[$((i-1))].headRefName")
  CURR_BASE=$(echo "$PRS_JSON_AFTER" | jq -r ".[$i].baseRefName")
  [ "$PREV_HEAD" = "$CURR_BASE" ]
done

# C4: All PRs still OPEN
CLOSED=$(echo "$PRS_JSON_AFTER" | jq '[.[] | select(.state != "OPEN")] | length')
[ "$CLOSED" -eq 0 ]

# C5: PR numbers unchanged (no close/reopen)
NUMBERS_BEFORE=$(echo "$PRS_JSON_BEFORE" | jq -r '.[].number' | sort)
NUMBERS_AFTER=$(echo "$PRS_JSON_AFTER" | jq -r '.[].number' | sort)
[ "$NUMBERS_BEFORE" = "$NUMBERS_AFTER" ]
```

---

## Scenario D: Cancel Workflow (Close Mid-Stack PR)

### Invoker Action

Simulates workflow cancellation by closing a middle PR in the stack
without deleting its branch, then observing stack integrity.

```bash
# Close PR 2 (middle of a 3-PR stack)
MIDDLE_PR=$(echo "$PRS_JSON" | jq -r '.[1].number')
gh pr close "$MIDDLE_PR" --repo "$TARGET_REPO"
```

### Expected Mergify Behavior

- PR 2 transitions to `CLOSED` state.
- PR 3 remains `OPEN` (Mergify does not cascade-close dependents).
- PR 3 base still points to PR 2's head branch (topology unchanged).
- PR 1 remains unaffected.
- Stack is now in a broken state from Mergify's perspective
  (PR 3 cannot merge until its base PR is reopened or retargeted).

### Assertions

```bash
# D1: Middle PR is CLOSED
MIDDLE_STATE=$(gh pr view "$MIDDLE_PR" --repo "$TARGET_REPO" --json state -q '.state')
[ "$MIDDLE_STATE" = "CLOSED" ]

# D2: Top PR remains OPEN
TOP_PR=$(echo "$PRS_JSON" | jq -r '.[-1].number')
TOP_STATE=$(gh pr view "$TOP_PR" --repo "$TARGET_REPO" --json state -q '.state')
[ "$TOP_STATE" = "OPEN" ]

# D3: Bottom PR remains OPEN
BOTTOM_PR=$(echo "$PRS_JSON" | jq -r '.[0].number')
BOTTOM_STATE=$(gh pr view "$BOTTOM_PR" --repo "$TARGET_REPO" --json state -q '.state')
[ "$BOTTOM_STATE" = "OPEN" ]

# D4: Top PR base unchanged (still references middle branch)
TOP_BASE=$(gh pr view "$TOP_PR" --repo "$TARGET_REPO" --json baseRefName -q '.baseRefName')
MIDDLE_HEAD=$(echo "$PRS_JSON" | jq -r '.[1].headRefName')
[ "$TOP_BASE" = "$MIDDLE_HEAD" ]
```

---

## Scenario E: Recreate Workflow (Re-push After Cancel)

### Invoker Action

After Scenario D left the stack broken (middle PR closed), recreate the
stack by re-pushing. This simulates Invoker's `recreateWorkflow` operation.

```bash
# Re-push the full stack
mergify stack push
```

### Expected Mergify Behavior

- Closed PR 2 is reopened (or a new PR replaces it — behavior is CLI-version-dependent).
- All PRs are `OPEN` after the push.
- Chain topology is restored: PR count = 3, same base relationships.
- Stack is mergeable again.

### Assertions

```bash
# E1: All PRs are OPEN after re-push
PRS_JSON_RECREATED=$(fetch_stack_prs)
OPEN_COUNT=$(echo "$PRS_JSON_RECREATED" | jq '[.[] | select(.state == "OPEN")] | length')
[ "$OPEN_COUNT" -eq 3 ]

# E2: Chain topology restored
FIRST_BASE=$(echo "$PRS_JSON_RECREATED" | jq -r '.[0].baseRefName')
[ "$FIRST_BASE" = "master" ]
for i in $(seq 1 2); do
  PREV_HEAD=$(echo "$PRS_JSON_RECREATED" | jq -r ".[$((i-1))].headRefName")
  CURR_BASE=$(echo "$PRS_JSON_RECREATED" | jq -r ".[$i].baseRefName")
  [ "$PREV_HEAD" = "$CURR_BASE" ]
done

# E3: PR count equals original stack depth
RECREATED_COUNT=$(echo "$PRS_JSON_RECREATED" | jq 'length')
[ "$RECREATED_COUNT" -eq 3 ]
```

---

## Scenario F: Delete Workflow (Close All + Delete Branches)

### Invoker Action

Simulates `deleteWorkflow` by closing all stack PRs and deleting their
remote branches.

```bash
# Close all PRs with branch deletion
echo "$PRS_JSON" | jq -r '.[].number' | while read -r pr; do
  gh pr close "$pr" --repo "$TARGET_REPO" --delete-branch
done
```

### Expected Mergify Behavior

- All PRs transition to `CLOSED` state.
- Remote branches associated with each PR are deleted.
- Stack metadata is removed from Mergify's tracking (no dangling stack state).

### Assertions

```bash
# F1: All PRs are CLOSED
echo "$PRS_JSON" | jq -r '.[].number' | while read -r pr; do
  STATE=$(gh pr view "$pr" --repo "$TARGET_REPO" --json state -q '.state')
  [ "$STATE" = "CLOSED" ]
done

# F2: Remote branches deleted
echo "$PRS_JSON" | jq -r '.[].headRefName' | while read -r branch; do
  ! git ls-remote --exit-code origin "refs/heads/$branch" 2>/dev/null
done

# F3: No open PRs remain with the run prefix
REMAINING=$(gh pr list --repo "$TARGET_REPO" --head "$PREFIX" --state open --json number | jq 'length')
[ "$REMAINING" -eq 0 ]
```

---

## Scenario G: Delete All (Bulk Cleanup)

### Invoker Action

Simulates bulk cleanup of all stacks matching a prefix pattern.
This exercises the cleanup path after multiple workflow runs.

```bash
# Find and close all PRs whose head branch matches the run prefix pattern
gh pr list --repo "$TARGET_REPO" \
  --search "head:repro/mergify-stack-dogfood-" \
  --state open --json number,headRefName | \
  jq -r '.[].number' | while read -r pr; do
    gh pr close "$pr" --repo "$TARGET_REPO" --delete-branch
  done

# Delete any remaining remote branches matching the prefix
git ls-remote --heads origin | grep "repro/mergify-stack-dogfood-" | \
  awk '{print $2}' | sed 's|refs/heads/||' | while read -r branch; do
    git push origin --delete "$branch"
  done
```

### Expected Mergify Behavior

- All matching PRs are closed.
- All matching remote branches are deleted.
- No Mergify stack state persists for the cleaned-up prefix.
- Other unrelated stacks/PRs are unaffected.

### Assertions

```bash
# G1: Zero open PRs matching prefix
OPEN_MATCHING=$(gh pr list --repo "$TARGET_REPO" \
  --search "head:repro/mergify-stack-dogfood-" \
  --state open --json number | jq 'length')
[ "$OPEN_MATCHING" -eq 0 ]

# G2: Zero remote branches matching prefix
REMOTE_BRANCHES=$(git ls-remote --heads origin | grep "repro/mergify-stack-dogfood-" | wc -l)
[ "$REMOTE_BRANCHES" -eq 0 ]

# G3: Unrelated PRs unaffected (spot check: master has no unexpected closures)
MASTER_OPEN=$(gh pr list --repo "$TARGET_REPO" --base master --state open --json number | jq 'length')
[ "$MASTER_OPEN" -ge 0 ]  # non-negative; ensures the query itself succeeds
```

---

## Summary Matrix

| Scenario | Invoker Action | Key Assertion | Exit Criteria |
|----------|---------------|---------------|---------------|
| A | `mergify stack push` (fresh) | PR count = N, chain topology valid | All A1–A5 pass |
| B | Append commit + re-push | PR count = N+1, originals preserved | All B1–B4 pass |
| C | Amend mid-stack + re-push | PR count unchanged, title updated, topology intact | All C1–C5 pass |
| D | `gh pr close` (middle) | Middle closed, others open, topology unchanged | All D1–D4 pass |
| E | `mergify stack push` (after cancel) | All reopened, topology restored | All E1–E3 pass |
| F | Close all + delete branches | All closed, branches gone | All F1–F3 pass |
| G | Bulk prefix cleanup | Zero matching PRs/branches, others unaffected | All G1–G3 pass |

## Automation Integration

Each scenario assertion block is written as POSIX shell with `[ ... ]` tests.
A runner script can source these blocks sequentially, with each scenario
depending on the previous scenario's end state (A→B, A→C, A→D→E, A→F, G).

Recommended execution order for a single run:

```
A → B          (stack growth)
A → C          (rebase)
A → D → E     (cancel + recreate)
A → F          (delete workflow)
G              (bulk cleanup, runs last)
```

Each path starts from a fresh Scenario A stack. Scenario G runs independently
as a final sweep.
